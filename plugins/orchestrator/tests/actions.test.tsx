import { expect } from "claude-code/testing";
import { test } from "./kit";
import { machine, seedFamily, start, captures } from "./fake-machine";
import { SURFACES, mountBand, mountPane, press, pressRow, rowAction, textOf, SHOW_PANE_ID } from "./ui";
import { CHILD, MANAGER, taskRows, NOW } from "./testdata";

for (const surface of SURFACES) {
  test(`[REQ-3, REQ-6, REQ-9] TEST-1401 [R1.3, R1.6; §6 Mod wiring] ${surface} Show opens first, displays details/screen, and Hide reaches ui.close next`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    const r = records.find(r => r.key === CHILD)!;
    h.seed({ ...r, tasks: taskRows(), holds: [{ what: "staging", since: NOW - 1000 }], deps: [{ kind: "release", ref: "api 2.0", note: "waiting on publication", since: NOW - 1000, doneAt: null }] });
    await start($, h, surface);
    const band = await mountBand($, surface);
    const key = await rowAction(band, "child-01", "Show");
    expect(key).toBeDefined();
    await h.clock.settle();
    h.effects.length = 0;
    await band.press({ key: key! });
    expect(h.effects[0]).toBe("ui.open");
    expect(h.opens.at(-1)).toMatchObject({ id: SHOW_PANE_ID, columns: 100, rows: 24 });
    await h.clock.settle();
    const pane = await mountPane($, surface);
    const text = await textOf(pane);
    for (const wanted of ["child-01", "Build API", "Review", "api 2.0", "staging", "live screen"]) expect(text).toContain(wanted);
    expect(captures(h)[0]).toEqual(["tmux", "capture-pane", "-p", "-N", "-t", "%702"]);
    await press(band, "Hide");
    expect(h.closes).toEqual([SHOW_PANE_ID]);
    const before = captures(h).length;
    await h.clock.advance(4000);
    expect(captures(h)).toHaveLength(before);
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1401 [R1.3, R1.6] ${surface} self Show contains tasks but never captures its own screen`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    h.seed({ ...records.find(r => r.key === MANAGER)!, tasks: taskRows() });
    await start($, h, surface);
    const band = await mountBand($, surface);
    await pressRow(band, "api-manager", "Show");
    const pane = await mountPane($, surface);
    expect(await textOf(pane)).toContain("Build API");
    expect(captures(h)).toEqual([]);
    expect(await rowAction(band, "api-manager", "Msg")).toBeUndefined();
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1402 [R1.6] ${surface} Jump binds tmux switching to the own client then selects the target`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    h.native(records.find(r => r.key === CHILD)!, "idle", { tmux: "other:@95.%474" });
    await start($, h, surface);
    const band = await mountBand($, surface);
    const before = h.commands.length;
    await pressRow(band, "child-01", "Jump");
    expect(h.commands.slice(before)).toEqual([
      ["tmux", "display-message", "-p", "-t", "%701", "#{client_tty}\t#{session_name}"],
      ["tmux", "switch-client", "-c", "/dev/tty-test", "-t", "other"],
      ["tmux", "select-window", "-t", "%474"], ["tmux", "select-pane", "-t", "%474"],
    ]);
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1402 [R1.6, R2.1] ${surface} herdr wins over inherited tmux for Show and Jump`, async ($, on) => {
    const h = machine(on, { mux: "herdr" }), records = seedFamily(h);
    h.seed({ ...records.find(r => r.key === CHILD)!, herdr: { pane: "child-pane", tab: "child-tab", workspace: "workspace" } });
    await start($, h, surface);
    const band = await mountBand($, surface);
    await pressRow(band, "child-01", "Jump");
    expect(h.commands).toContainEqual(["herdr", "agent", "focus", "child-pane"]);
    await pressRow(band, "child-01", "Show");
    await h.clock.settle();
    expect(captures(h)[0]).toEqual(["herdr", "pane", "read", "child-pane", "--source", "visible", "--format", "text"]);
    expect(h.commands.some(a => a[0] === "tmux")).toBe(false);
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1402 [R1.6, R2.1] ${surface} cross-mux Show keeps details and Jump reports unreachable`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    h.seed({ ...records.find(r => r.key === CHILD)!, tasks: taskRows(), herdr: { pane: "other-pane", tab: null, workspace: null } });
    await start($, h, surface);
    const band = await mountBand($, surface);
    await pressRow(band, "child-01", "Jump");
    expect(h.toasts.join("\n")).toContain("not reachable from this multiplexer");
    await pressRow(band, "child-01", "Show");
    const pane = await mountPane($, surface);
    expect(await textOf(pane)).toContain("Build API");
    expect(await textOf(pane)).toContain("not reachable from this multiplexer");
    expect(captures(h)).toEqual([]);
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1403 [R1.6; final Open decision] ${surface} Open is a button using opener fallback and a final URL toast`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    const url = records.find(r => r.key === CHILD)!.ticket!.url!;
    await start($, h, surface);
    const band = await mountBand($, surface);
    h.openerExits = [1, 0];
    await pressRow(band, "child-01", "Open");
    expect(h.commands.filter(a => ["open", "xdg-open"].includes(a[0]!))).toEqual([["open", url], ["xdg-open", url]]);
    expect(h.toasts).toEqual([]);
    h.openerExits = [1, 1];
    await pressRow(band, "child-01", "Open");
    expect(h.toasts.join("\n")).toContain(url);
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1404 [R1.6] ${surface} Msg fills the prompt, its refusal supplies text, and nameless rows hide it`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    await start($, h, surface);
    const band = await mountBand($, surface);
    await pressRow(band, "child-01", "Msg");
    expect(h.fills).toEqual([{ text: "SendMessage to child-01: ", mode: "replace" }]);
    h.fillAllowed = false;
    await pressRow(band, "child-01", "Msg");
    expect(h.toasts.join("\n")).toContain("close the dialog first");
    expect(h.toasts.join("\n")).toContain("SendMessage to child-01:");
    const r = records.find(r => r.key === CHILD)!;
    h.seed({ ...r, name: null, ticket: null });
    h.native({ ...r, name: null }, "idle");
    await h.clock.advance(2000);
    expect(await rowAction(band, CHILD, "Msg")).toBeUndefined();
    expect(await rowAction(band, CHILD, "Show")).toBeDefined();
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1405 [R1.6] ${surface} unplaced Show reports the reason without capturing`, async ($, on) => {
    const h = machine(on, { placed: false }); seedFamily(h);
    await start($, h, surface);
    const band = await mountBand($, surface);
    await pressRow(band, "child-01", "Show");
    expect(h.opens.at(-1)?.id).toBe(SHOW_PANE_ID);
    expect(h.toasts.join("\n")).toContain("test surface has no room");
    await h.clock.advance(2000);
    expect(captures(h)).toEqual([]);
  });

  test(`[REQ-3, REQ-6, REQ-9] TEST-1405 [R1.6; §4.7 cadence] ${surface} three failed captures stop and show the pane-gone note`, async ($, on) => {
    const h = machine(on); seedFamily(h); h.captureExit = 1;
    await start($, h, surface);
    const band = await mountBand($, surface);
    await pressRow(band, "child-01", "Show");
    const pane = await mountPane($, surface);
    await h.clock.advance(3000);
    expect(await textOf(pane)).toContain("the pane is gone");
    expect(captures(h)).toHaveLength(3);
    await h.clock.advance(3000);
    expect(captures(h)).toHaveLength(3);
  });
}
