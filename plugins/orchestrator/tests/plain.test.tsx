import { expect } from "claude-code/testing";
import { test } from "./kit";
import { machine, seedFamily } from "./fake-machine";
import { SURFACES, mountBand, ENGINE_DRAWING, engineOwn, textOf } from "./ui";
import { SELF } from "./testdata";

for (const surface of SURFACES) {
  test(`[REQ-7, REQ-16] TEST-1201 [R1.7, R3.4; §6 Mod wiring] plain ${surface} draws only the engine and checks only its index`, async ($, on) => {
    const h = machine(on);
    const band = await mountBand($, surface);
    await h.clock.advance(15_000);
    expect(engineOwn(await band.drawn())).toEqual(ENGINE_DRAWING);
    expect(h.commands).toEqual([]);
    expect(h.fsCalls.length).toBeGreaterThanOrEqual(3);
    expect(h.fsCalls.every(c => c.op === "exists" && c.path === h.stateDir + "/by-session/" + SELF)).toBe(true);
    const times = h.fsCalls.map(c => c.at);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBe(5000);
  });

  test(`[REQ-7, REQ-16] TEST-1202 [R1.7; §6 Mod wiring] ${surface} lazy mount subscribes before returning and discovers mid-session registration`, async ($, on) => {
    const h = machine(on);
    const band = await mountBand($, surface);
    await h.clock.settle();
    expect(engineOwn(await band.drawn())).toEqual(ENGINE_DRAWING);
    seedFamily(h);
    await h.clock.advance(5000);
    expect(await textOf(band)).toContain("orchestrator");
    expect(await textOf(band)).toContain("api-manager");
    expect(await textOf(band)).toContain("child-01");
    expect(h.commands.some(argv => argv.includes("ps"))).toBe(true);
  });
}
