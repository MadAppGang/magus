import { expect } from "claude-code/testing";
import { test } from "./kit";
import { machine, seedFamily, start } from "./fake-machine";
import { SURFACES, mountBand, mountPane, pressRow, textOf } from "./ui";
import { CHILD, MANAGER, NOW, TRIAGE } from "./testdata";

const TICKET = { id: "ABC-463", url: "https://example.test/ABC-463" };

for (const surface of SURFACES) {
  test(`TEST-1321 ${surface} band draws one line per session: ticket-first labels, counts and the last column`, async ($, on) => {
    const h = machine(on), records = seedFamily(h, 2);
    const triage = records.find(r => r.key === TRIAGE)!;
    const manager = records.find(r => r.key === MANAGER)!;
    const child = records.find(r => r.key === CHILD)!;
    const second = records.find(r => r.key !== TRIAGE && r.key !== MANAGER && r.key !== CHILD)!;
    h.seed({ ...manager, tasks: [
      { n: 1, step: "Done step", who: "this session", state: "Done" },
      { n: 2, step: "Panel mockup", who: "this session", state: "In progress" },
    ] });
    const ledChild = { ...child, name: "abc-463-auth-config-dir-key", ticket: TICKET, blocked: { reason: "Approve the schema change", since: NOW - 1000 } };
    h.seed(ledChild);
    h.native(ledChild, "idle");
    h.seed({ ...second, deps: [{ kind: "session", ref: triage.key, note: "plan", since: NOW - 1000, doneAt: null }] });
    await start($, h, surface);
    const band = await mountBand($, surface);
    const text = await textOf(band);
    expect(text).toContain("orchestrator · 4 sessions · 1 needs you · 1 waiting");
    expect(text).toContain("ABC-463 auth-config");
    expect(text).toContain("⚠");
    expect(text).toContain("? Approve the schema change");
    expect(text).toContain("⇠ triage (plan)");
    expect(text).toContain("▶ Panel mockup");
    // the ticket-led row carries no separate ticket cell
    expect(text.split("\n").filter(l => l.trim() === "ABC-463")).toEqual([]);
  });

  test(`TEST-1322 ${surface} the session view groups tasks, wraps steps and lists the family both ways`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    const triage = records.find(r => r.key === TRIAGE)!;
    const child = records.find(r => r.key === CHILD)!;
    const long = "Find why claude-fable-5-2 and minimax-m3 have no effort rows in the bundled list of every provider";
    h.seed({ ...child, tasks: [
      { n: 1, step: long, who: "this session", state: "In progress" },
      { n: 2, step: "Effort rows for both models", who: "release child", state: "Waiting on 1" },
    ], deps: [{ kind: "session", ref: triage.key, note: null, since: NOW - 1000, doneAt: null }] });
    h.seed({ ...triage, deps: [{ kind: "session", ref: child.name!, note: null, since: NOW - 1000, doneAt: null }] });
    await start($, h, surface);
    const band = await mountBand($, surface);
    await pressRow(band, "child-01", "Show");
    await h.clock.settle();
    const pane = await mountPane($, surface);
    const text = await textOf(pane);
    const lines = text.split("\n");
    for (const wanted of ["Now", "Next", "Family", " ▶ 1  Find why", " ○ 2  Effort rows for both models", "      release child · after 1 Find why",
      " triage (triage) ⇠ waits on child-01", " child-01 ⇠ waits on triage"]) {
      expect(lines.some(l => l.startsWith(wanted) || l === wanted)).toBe(true);
    }
    // the step is wrapped over several lines, every word kept, none cut
    const from = lines.findIndex(l => l.startsWith(" ▶ 1  "));
    const to = lines.indexOf("Next");
    expect(to - from).toBeGreaterThan(1);
    expect(lines.slice(from, to).map(l => l.trim()).join(" ")).toBe("▶ 1  " + long);
    expect(lines.slice(from, to).join(" ")).not.toContain("…");
  });

  test(`TEST-1325 ${surface} a row that needs the user reads needs you on its badge; one waiting on another session draws ◷`, async ($, on) => {
    const h = machine(on), records = seedFamily(h, 2);
    const triage = records.find(r => r.key === TRIAGE)!;
    const child = records.find(r => r.key === CHILD)!;
    const second = records.find(r => r.key !== TRIAGE && r.key !== MANAGER && r.key !== CHILD)!;
    h.seed({ ...child, blocked: { reason: "Approve", since: NOW - 1000 } });
    h.seed({ ...second, deps: [{ kind: "session", ref: triage.key, note: null, since: NOW - 1000, doneAt: null }] });
    await start($, h, surface);
    const band = await mountBand($, surface);
    const texts = (await band.findAll({ type: "Text" })).map(t => t.text);
    expect(texts).toContain(" needs you ");
    expect(texts).not.toContain(" blocked ");
    expect(texts.map(t => t.trim())).toContain("◷");
    expect(texts.map(t => t.trim())).not.toContain("◆");
    await pressRow(band, "child-01", "Show");
    await h.clock.settle();
    const pane = await mountPane($, surface);
    const paneTexts = (await pane.findAll({ type: "Text" })).map(t => t.text);
    expect(paneTexts).toContain(" needs you ");
    expect(paneTexts).not.toContain(" blocked ");
  });

  test(`TEST-1323 ${surface} a refused ps says why in the header, in the error tone`, async ($, on) => {
    const h = machine(on); seedFamily(h);
    h.denyPs = true;
    await start($, h, surface);
    const band = await mountBand($, surface);
    await h.clock.advance(2000);
    const header = (await band.findAll({ type: "Text" })).find(t => t.text.startsWith("orchestrator ·"));
    expect(header?.text).toMatch(/^orchestrator · 3 sessions · ⚠ states unreadable: ps refused \(.+\)$/);
    expect(header?.props.color).toBe("error");
    expect(await textOf(band)).toContain("unknown");
  });

  test(`TEST-1324 ${surface} a ps exiting non-zero names its exit and its stderr's first line`, async ($, on) => {
    const h = machine(on); seedFamily(h);
    h.psExit = 1;
    await start($, h, surface);
    const band = await mountBand($, surface);
    await h.clock.advance(2000);
    expect(await textOf(band)).toContain("orchestrator · 3 sessions · ⚠ states unreadable: ps exited 1 (ps failed)");
    h.psExit = 0;
    await h.clock.advance(12_000);
    expect(await textOf(band)).not.toContain("unreadable");
  });
}
