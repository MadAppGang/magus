// The per-user config file, <state dir>/config.json. Reading never throws;
// writing goes to a temp file beside it and renames, so a reader always sees a
// whole file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ConfigParse, type UserConfig, parseUserConfig, serializeUserConfig } from "./mux-choice.ts";
import { writeAtomic } from "./record-store.ts";

export function userConfigPath(stateDir: string): string {
  return join(stateDir, "config.json");
}

/** The parsed config; a missing file is an empty config, an unreadable one `ok:false`. */
export function readUserConfig(stateDir: string): ConfigParse {
  let text: string | null;
  try {
    text = readFileSync(userConfigPath(stateDir), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, error: `config.json could not be read: ${err instanceof Error ? err.message : String(err)}` };
    }
    text = null;
  }
  return parseUserConfig(text);
}

/** Replaces the config file atomically. Throws when the write fails. */
export function writeUserConfig(stateDir: string, config: UserConfig): void {
  writeAtomic(userConfigPath(stateDir), serializeUserConfig(config));
}
