/**
 * catalog-index.test.ts — catalog index descriptor invariants (TEST-16, REQ-5).
 *
 * Verifies:
 * - mnemex declares { worktrees: "engine-managed", path: ".mnemex/index.db" } and has no copy.
 * - serena has no projectStep and no index.
 * - For every catalog entry declaring index:
 *   - index.path === projectStep.marker
 *   - worktrees === "engine-managed" has no copy key
 *   - worktrees === "copy" has:
 *     - paths === "relative" and incremental === true
 *     - owned contains index.path
 *     - copy.include ends with index.path
 *     - every copy.include entry is equal to or under an owned entry
 *     - copy.update[0] is one of the entry's binaries
 *     - copy.updateRefreshesModified === true
 *     - copy.inspect never throws and returns complete:false when unrecorded
 */

import { describe, expect, test } from "bun:test";
import type { IndexDescriptor, IndexSource } from "../core/index-descriptor";
import { CATALOG } from "./catalog";

function isUnderOwned(relPath: string, owned: readonly string[]): boolean {
  return owned.some((o) => {
    const clean = o.replace(/\/+$/u, "");
    return relPath === clean || relPath.startsWith(`${clean}/`);
  });
}

const EMPTY_SOURCE: IndexSource = {
  exists: () => false,
  sqlite: () => undefined,
  json: () => undefined,
  close: () => {},
};

describe("TEST-16: catalog index descriptor invariants (REQ-5)", () => {
  test("REQ-5: mnemex declares engine-managed with path .mnemex/index.db and no copy", () => {
    const mnemex = CATALOG["mnemex"] as { index?: IndexDescriptor; projectStep?: { marker: string } };
    expect(mnemex.index).toEqual({
      worktrees: "engine-managed",
      path: ".mnemex/index.db",
    });
    expect(mnemex.index && "copy" in mnemex.index).toBe(false);
  });

  test("REQ-5: serena has no projectStep and no index descriptor", () => {
    const serena = CATALOG["serena"] as { index?: IndexDescriptor; projectStep?: unknown };
    expect(serena.projectStep).toBeUndefined();
    expect(serena.index).toBeUndefined();
  });

  test("REQ-5: every declared index descriptor satisfies marker, owned, include, and binaries invariants", () => {
    let seenIndexCount = 0;
    for (const [id, rawEntry] of Object.entries(CATALOG)) {
      const entry = rawEntry as {
        binaries: readonly string[];
        projectStep?: { marker: string };
        index?: IndexDescriptor;
      };
      if (entry.index === undefined) continue;
      seenIndexCount += 1;

      expect(entry.projectStep?.marker, `${id}: index.path must equal projectStep.marker`).toBe(
        entry.index.path,
      );

      if (entry.index.worktrees === "engine-managed") {
        expect("copy" in entry.index, `${id}: engine-managed must have no copy`).toBe(false);
        continue;
      }

      expect(entry.index.worktrees).toBe("copy");
      expect(entry.index.paths).toBe("relative");
      expect(entry.index.incremental).toBe(true);
      expect(entry.index.copy.updateRefreshesModified).toBe(true);

      // owned contains path (either directly or as an enclosing owned directory, and every include entry is under owned):
      expect(
        entry.index.owned.includes(entry.index.path) ||
          isUnderOwned(entry.index.path, entry.index.owned),
        `${id}: owned must cover index.path`,
      ).toBe(true);

      const include = entry.index.copy.include;
      expect(include.length, `${id}: include must be non-empty`).toBeGreaterThan(0);
      expect(include[include.length - 1], `${id}: include must end with index.path`).toBe(
        entry.index.path,
      );

      for (const inc of include) {
        expect(
          isUnderOwned(inc, entry.index.owned),
          `${id}: include entry ${inc} must be under an owned entry`,
        ).toBe(true);
      }

      const updateCmd = entry.index.copy.update[0];
      expect(typeof updateCmd, `${id}: copy.update[0] must exist`).toBe("string");
      expect(
        entry.binaries,
        `${id}: copy.update[0] (${String(updateCmd)}) must be in entry.binaries`,
      ).toContain(updateCmd as string);

      // inspect() never throws on an empty/missing source and returns complete:false:
      expect(entry.index.copy.inspect(EMPTY_SOURCE)).toEqual({ complete: false });
    }
    expect(seenIndexCount).toBeGreaterThanOrEqual(1);
  });
});
