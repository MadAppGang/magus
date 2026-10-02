/**
 * node-io.ts — the real, read-only `CheckIo` for the fast setup check.
 *
 * Plain `node:fs` stats and reads, nothing else: no `run`, no `fetchText`. That is what
 * lets the SessionStart hook and the MCP server share the evaluator without either one
 * being able to spawn a process through it. The setup CLI extends this with the two
 * (`scripts/setup/io.ts`).
 *
 * `node:fs`, not `Bun.*` (A9): the plugin's typecheck carries only the `bun-types`
 * pieces it needs, and a PATH lookup is four stats, not a runtime feature.
 *
 * Every method swallows its error into the "absent" answer, because `CheckIo` promises
 * never to throw: a settings file the user cannot read is a finding, not a crash.
 */

import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";

import type { CheckIo, PathKind } from "./check";

export function makeNodeCheckIo(env: Readonly<Record<string, string | undefined>> = process.env): CheckIo {
  return {
    env,
    readText(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    readBytes(path: string): Uint8Array | undefined {
      try {
        return new Uint8Array(readFileSync(path));
      } catch {
        return undefined;
      }
    },
    kind(path: string): PathKind {
      try {
        const stats = statSync(path);
        if (stats.isFile()) return "file";
        if (stats.isDirectory()) return "directory";
        return "other";
      } catch {
        return "missing";
      }
    },
    isExecutable(path: string): boolean {
      try {
        if (!statSync(path).isFile()) return false;
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    realpath(path: string): string | undefined {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
  };
}
