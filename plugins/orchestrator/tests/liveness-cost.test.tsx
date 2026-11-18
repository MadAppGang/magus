// REGRESSION: the status mod's liveness poll ran a multi-pid `ps -p` list on every tick
import { expect } from "claude-code/testing";
import { test } from "./kit";
import { machine, seedFamily, start, type Machine } from "./fake-machine";
import { SURFACES, mountBand, textOf } from "./ui";
import { LATER_START, NOW, CHILD } from "./testdata";

const WINDOW_MS = 30_000, TICK_MS = 2000, RECHECK_MS = 10_000;
const psRuns = (h: Machine, from = 0) => h.commands.slice(from).filter(argv => argv.includes("ps"));
// A `-p` naming two or more pids, by list or by repeating the flag.
const multiPid = (argv: string[]) =>
  argv.filter(a => a === "-p").length > 1 || argv.some((a, i) => a === "-p" && (argv[i + 1] ?? "").includes(","));
async function tickFor(h: Machine, ms: number) {
  for (let t = 0; t < ms; t += TICK_MS) await h.clock.advance(TICK_MS);
}

for (const surface of SURFACES) {
  test(`TEST-1311 [R1.8 cost] ${surface} liveness never asks ps about more than one pid by -p`, async ($, on) => {
    const h = machine(on); seedFamily(h, 2);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-02");
    await tickFor(h, WINDOW_MS);
    expect(psRuns(h).length).toBeGreaterThan(0);
    expect(psRuns(h).filter(multiPid)).toEqual([]);
  });

  test(`TEST-1312 [R1.8 cost] ${surface} liveness runs ps at most once per re-check interval while rows stay active`, async ($, on) => {
    const h = machine(on); seedFamily(h, 2);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-02");
    const before = h.commands.length;
    await tickFor(h, WINDOW_MS);
    expect(psRuns(h, before).length).toBeLessThanOrEqual(Math.ceil(WINDOW_MS / RECHECK_MS) + 1);
  });

  test(`TEST-1313 [R1.8 reuse] ${surface} a reused pid reads gone within the re-check interval and its new file is never adopted`, async ($, on) => {
    const h = machine(on), records = seedFamily(h, 2);
    const child = records.find(r => r.key === CHILD)!;
    h.native(child, "busy");
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-01");
    const pid = child.pid!;
    h.starts.set(pid, LATER_START);
    h.files.set(h.sessionsDir + "/" + pid + ".json", JSON.stringify({
      pid, procStart: LATER_START, sessionId: "different1", status: "busy", name: "replacement",
      tmux: "other:@99.%999", statusUpdatedAt: NOW, updatedAt: NOW,
    }));
    await h.clock.advance(TICK_MS);
    const stale = await textOf(band);
    expect(stale).not.toContain("replacement");
    expect(stale).not.toContain("other:@99");
    expect(stale).not.toContain("%999");
    await tickFor(h, RECHECK_MS);
    const text = await textOf(band);
    expect(text).toContain("gone");
    expect(text).not.toContain("replacement");
    expect(text).toContain("child-01");
    expect(text).not.toContain("other:@99");
    expect(text).not.toContain("%999");
  });

  test(`TEST-1314 [R1.8 denied] ${surface} a denied ps caches nothing dead and the next successful check shows the live rows`, async ($, on) => {
    const h = machine(on); seedFamily(h, 2);
    h.denyPs = true;
    await start($, h, surface);
    const band = await mountBand($, surface);
    await h.clock.advance(TICK_MS);
    const denied = await textOf(band);
    expect(denied).toContain("unknown");
    expect(denied).not.toContain("gone");
    h.denyPs = false;
    const before = h.commands.length;
    await h.clock.advance(TICK_MS);
    expect(psRuns(h, before).length).toBeGreaterThan(0);
    const live = await textOf(band);
    expect(live).not.toContain("unknown");
    expect(live).not.toContain("gone");
    expect(live).toContain("child-02");
  });

  test(`TEST-1315 [R1.8 failed] ${surface} a ps exiting non-zero caches nothing dead and the next successful check shows the live rows`, async ($, on) => {
    const h = machine(on); seedFamily(h, 2);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-02");
    h.psExit = 1;
    await tickFor(h, RECHECK_MS + TICK_MS);
    const failed = await textOf(band);
    expect(failed).not.toContain("gone");
    h.psExit = 0;
    const before = h.commands.length;
    await tickFor(h, RECHECK_MS + TICK_MS);
    expect(psRuns(h, before).length).toBeGreaterThan(0);
    const live = await textOf(band);
    expect(live).not.toContain("unknown");
    expect(live).not.toContain("gone");
    expect(live).toContain("child-02");
  });
}
