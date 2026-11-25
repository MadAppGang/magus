// REGRESSION: the status band read every session record on every tick
import { expect } from "claude-code/testing";
import { test } from "./kit";
import { machine, seedFamily, start, type Machine } from "./fake-machine";
import { SURFACES, mountBand, textOf } from "./ui";
import { record, taskRows, ROOT, NOW, MANAGER, CHILD } from "./testdata";
import { RELIST_MS } from "../hooks/status/domain";

const TICK_MS = 2000, IDLE_TICKS = 15, OTHERS = 40;
const OTHER_PRODUCT = ROOT + "/other-product";
const SECOND_CHILD = "s-child002";

const sessionsOf = (h: Machine) => h.stateDir + "/sessions/";
const progressOf = (h: Machine) => h.stateDir + "/progress/";
const identityPath = (h: Machine, key: string) => sessionsOf(h) + key + ".json";
const progressPath = (h: Machine, key: string) => progressOf(h) + key + ".json";
/** The sessions/ or progress/ directory itself, or anything in it. */
const underRecords = (h: Machine, path: string) => {
  const p = path.replace(/\/+$/, "") + "/";
  return p.startsWith(sessionsOf(h)) || p.startsWith(progressOf(h));
};
// The owning check reads this session's own identity file each tick to confirm the index entry
// names a record carrying its id; that read is not the record scan this file measures.
const isOwnerCheck = (h: Machine, path: string) => path === identityPath(h, MANAGER);
const recordReads = (h: Machine) => h.fsCalls.filter(c => c.op === "read" && underRecords(h, c.path) && !isOwnerCheck(h, c.path));
const recordLists = (h: Machine) => h.fsCalls.filter(c => c.op === "list" && underRecords(h, c.path));
const listsOf = (h: Machine, dir: string) => h.fsCalls.filter(c => c.op === "list" && c.path.replace(/\/+$/, "") + "/" === dir).length;
/** Ticks enough to cross one full relist window from any starting point. */
const RELIST_TICKS = Math.ceil(RELIST_MS / TICK_MS) + 1;

/** The family of seedFamily(h, 2), plus OTHERS records of another product, every second one with no progress file. */
function seedCrowd(h: Machine) {
  const records = seedFamily(h, 2);
  for (let i = 1; i <= OTHERS; i++) {
    const n = String(i).padStart(3, "0");
    const r = record({
      key: "s-other" + n, sessionId: "other" + n + "x", role: "manager", parent: null,
      name: "other-" + n, product: OTHER_PRODUCT, cwd: OTHER_PRODUCT, pid: null, procStart: null,
      createdAt: NOW - 50_000 + i,
    });
    h.seed(r);
    if (i % 2 === 0) h.files.delete(progressPath(h, r.key));
  }
  return records;
}
async function ticks(h: Machine, n: number) {
  for (let i = 0; i < n; i++) await h.clock.advance(TICK_MS);
}

for (const surface of SURFACES) {
  test(`TEST-1331 [R1.8 cost] ${surface} an idle band reads no session record or progress file and lists each directory at most once per relist window`, async ($, on) => {
    const h = machine(on); seedCrowd(h);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-02");
    h.fsCalls.length = 0;
    await ticks(h, IDLE_TICKS);
    expect(await textOf(band)).toContain("child-02");
    // the owning check still runs every tick, so the loop did tick
    expect(h.fsCalls.filter(c => c.op === "exists").length).toBeGreaterThanOrEqual(IDLE_TICKS);
    expect(recordReads(h).length).toBe(0);
    // each directory is listed again at most once per RELIST_MS even when nothing moved it
    const bound = Math.floor((IDLE_TICKS * TICK_MS) / RELIST_MS) + 1;
    expect(listsOf(h, sessionsOf(h))).toBeLessThanOrEqual(bound);
    expect(listsOf(h, progressOf(h))).toBeLessThanOrEqual(bound);
  });

  test(`TEST-1332 [R1.8 change] ${surface} a changed record shows on the next tick and only its two files are read`, async ($, on) => {
    const h = machine(on), records = seedCrowd(h);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-01");
    expect(await textOf(band)).not.toContain("1/2");
    await ticks(h, 2);
    const child = records.find(r => r.key === CHILD)!;
    h.fsCalls.length = 0;
    h.seed({ ...child, tasks: taskRows(), rev: 1, updatedAt: NOW });
    await h.clock.advance(TICK_MS);
    expect(await textOf(band)).toContain("1/2");
    const read = [...new Set(recordReads(h).map(c => c.path))].sort();
    expect(read).toEqual([identityPath(h, CHILD), progressPath(h, CHILD)].sort());
  });

  test(`TEST-1333 [R1.8 start/remove] ${surface} a new record appears and a removed one disappears on the next tick`, async ($, on) => {
    const h = machine(on); seedCrowd(h);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-02");
    expect(await textOf(band)).not.toContain("child-03");
    await ticks(h, 2);
    const third = record({
      key: "s-child003", sessionId: "child003", mux: { kind: "tmux", nesting: null },
      role: "child", parent: MANAGER, name: "child-03", pid: 704, createdAt: NOW - 500,
    });
    h.seed(third); h.native(third, "idle");
    await h.clock.advance(TICK_MS);
    expect(await textOf(band)).toContain("child-03");
    h.files.delete(identityPath(h, SECOND_CHILD));
    h.files.delete(progressPath(h, SECOND_CHILD));
    await h.clock.advance(TICK_MS);
    const text = await textOf(band);
    expect(text).not.toContain("child-02");
    expect(text).toContain("child-03");
    expect(text).toContain("child-01");
  });

  test(`TEST-1334 [R1.8 missing] ${surface} a progress file that does not exist is never read`, async ($, on) => {
    const h = machine(on); seedCrowd(h);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-02");
    await ticks(h, IDLE_TICKS);
    // no progress file is written or removed in this test, so the final map is the map at every read
    const missing = [...new Set(h.fsCalls
      .filter(c => c.op === "read" && c.path.startsWith(progressOf(h)) && !h.files.has(c.path))
      .map(c => c.path))];
    expect(missing).toEqual([]);
  });

  test(`TEST-1335 [R1.8 refused] ${surface} a refused read or listing during a change heals without another write`, async ($, on) => {
    const h = machine(on), records = seedCrowd(h);
    await start($, h, surface);
    const band = await mountBand($, surface);
    expect(await textOf(band)).toContain("child-02");
    await ticks(h, 2);
    const child = records.find(r => r.key === CHILD)!;
    // a progress read refused in the tick that sees the change: the next ticks read it again
    h.denyReadsUnder = progressOf(h);
    h.seed({ ...child, tasks: taskRows(), rev: 1, updatedAt: NOW });
    await h.clock.advance(TICK_MS);
    h.denyReadsUnder = null;
    await ticks(h, 2);
    expect(await textOf(band)).toContain("child-02");
    expect(await textOf(band)).toContain("1/2");
    // a listing refused in the tick that sees a change: a full relist within one window restores it
    const second = records.find(r => r.key === SECOND_CHILD)!;
    h.denyLists = true;
    h.seed({ ...second, rev: 1, updatedAt: NOW });
    await h.clock.advance(TICK_MS);
    h.denyLists = false;
    await ticks(h, RELIST_TICKS);
    expect(await textOf(band)).toContain("child-02");
    expect(await textOf(band)).toContain("1/2");
  });
}
