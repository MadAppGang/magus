import { expect } from "claude-code/testing";
import { test } from "./kit";
import { machine, seedFamily, start } from "./fake-machine";
import { SURFACES, mountBand, bandProps, textOf, rowAction, ENGINE_DRAWING, engineOwn } from "./ui";
import { NOW, LATER_START, MANAGER, CHILD, taskRows } from "./testdata";

for (const surface of SURFACES) {
  test(`[REQ-1, REQ-2, REQ-5, REQ-8] TEST-1301 [R1.1–R1.2, R1.5; §6 Mod wiring] ${surface} draws family rows from files, not canned atom values`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
    const manager = records.find(r => r.key === MANAGER)!;
    h.seed({ ...manager, tasks: taskRows(), deps: [{ kind: "release", ref: "api 2.0", note: null, since: NOW - 180_000, doneAt: null }] });
    h.native(manager, "waiting", { waitingFor: "approval" });
    await start($, h, surface);
    const band = await mountBand($, surface);
    const text = await textOf(band);
    for (const label of ["triage", "api-manager", "child-01", "example/product#7", "1/2", "approval"]) expect(text).toContain(label);
    expect(await band.findAll({ type: "Button", text: "Show" })).toHaveLength(3);
    expect(text).toMatch(/1 needs you/);
    expect(await rowAction(band, "api-manager", "Jump")).toBeUndefined();
    expect(await rowAction(band, "api-manager", "Msg")).toBeUndefined();
    expect(await rowAction(band, "child-01", "Jump")).toBeDefined();
    expect(h.fsCalls.some(c => c.path === h.sessionsDir + "/701.json" && c.op === "read")).toBe(true);
  });

  test(`[REQ-1, REQ-2, REQ-5, REQ-8] TEST-1302 [R1.7; §6 Mod wiring] ${surface} survey yields to the engine instead of drawing a band`, async ($, on) => {
    const h = machine(on); seedFamily(h);
    await start($, h, surface);
    const band = await mountBand($, surface, bandProps(140, 20, true));
    expect(engineOwn(await band.drawn())).toEqual(ENGINE_DRAWING);
  });

  test(`[REQ-1, REQ-2, REQ-5, REQ-8] TEST-1303 [R1.8; §6 Mod wiring] ${surface} removes dead/reused-pid live fields in the next active tick`, async ($, on) => {
    const h = machine(on), records = seedFamily(h);
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
    const before = h.fsCalls.length;
    await h.clock.advance(2000);
    const text = await textOf(band);
    expect(text).toContain("gone");
    expect(text).not.toContain("replacement");
    expect(text).toContain("child-01");
    expect(h.fsCalls.slice(before).filter(c => c.op === "read" && c.path === h.sessionsDir + "/" + pid + ".json")).toHaveLength(0);
    h.starts.delete(pid);
    await h.clock.advance(2000);
    expect(await textOf(band)).toContain("gone");
  });
}
