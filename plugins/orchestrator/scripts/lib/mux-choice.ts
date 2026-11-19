// Pure rules for choosing where a new ticket window opens, and the per-user
// config file's format. Imports nothing but the shared multiplexer facts, reads
// nothing: every fact is passed in. Where THIS session lives is
// detectSessionMux's question (hooks/lib/mux-core.ts), and the stored choice
// never enters it; chooseWindowMux answers where a NEW TICKET WINDOW opens, and
// the stored choice enters only when the answer would otherwise be ambiguous.

import { type Multiplexer, NOT_IN_A_MULTIPLEXER, type SessionMux } from "../../hooks/lib/mux-core.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type AskReason = "herdr-in-tmux" | "herdr-installed";

export interface WindowMuxFacts {
  env: Readonly<Record<string, string | undefined>>;
  session: SessionMux;
  /** The stored per-user choice; null when none or unreadable. */
  stored: Multiplexer | null;
  /** A herdr executable was found. */
  herdrInstalled: boolean;
}

export type WindowMux =
  | {
      ok: true;
      mux: Multiplexer;
      source: "forced" | "stored" | "detected" | "provisional";
      /** Non-null: an interactive caller should ask once and store the answer. */
      ask: AskReason | null;
      /** One sentence for the user, or null. */
      note: string | null;
    }
  | { ok: false; error: string };

const STORED_HERDR_NOTE = "New ticket windows open as herdr tabs (your stored choice). This session's own children stay in this tmux window.";

/** Where a new ticket window opens. Never throws. */
export function chooseWindowMux(facts: WindowMuxFacts): WindowMux {
  const { session, stored, herdrInstalled } = facts;
  if (!session.ok) return { ok: false, error: session.error };
  const result = (
    mux: Multiplexer,
    source: "forced" | "stored" | "detected" | "provisional",
    ask: AskReason | null = null,
    note: string | null = null,
  ): WindowMux => ({ ok: true, mux, source, ask, note });

  if (session.source === "forced") return result(session.mux, "forced");
  if (session.nesting === "herdr-in-tmux") return stored !== null ? result(stored, "stored") : result("herdr", "provisional", "herdr-in-tmux");
  if (session.mux === "herdr") return result("herdr", "detected");
  if (!herdrInstalled) return result("tmux", "detected");
  if (stored === "herdr") return result("herdr", "stored", null, STORED_HERDR_NOTE);
  if (stored === "tmux") return result("tmux", "stored");
  return result("tmux", "provisional", "herdr-installed");
}

export type StartMux = { ok: true; mux: Multiplexer } | { ok: false; error: string };

/**
 * Where `ticket-window.ts` start opens. `named`: `--session <name>` was given,
 * which names a tmux session, so the stored choice never enters that route.
 * `forced`: a non-empty ORCHESTRATOR_MULTIPLEXER. Never throws.
 */
export function chooseStartMux(facts: { session: SessionMux; windows: WindowMux; named: boolean; forced: boolean }): StartMux {
  const { session, windows, named, forced } = facts;
  if (!named) {
    if (windows.ok) return { ok: true, mux: windows.mux };
    return {
      ok: false,
      error:
        windows.error === NOT_IN_A_MULTIPLEXER
          ? `${NOT_IN_A_MULTIPLEXER}; run it from a tmux pane or a herdr tab, or pass --session <name> for a tmux session`
          : windows.error,
    };
  }
  if (session.ok) {
    if (session.mux === "tmux") return { ok: true, mux: "tmux" };
    return { ok: false, error: "--session is tmux only; under herdr the ticket opens as a tab in the current workspace (ORCHESTRATOR_MULTIPLEXER=tmux forces tmux)" };
  }
  // A named tmux session can be created from outside any multiplexer.
  return forced ? { ok: false, error: session.error } : { ok: true, mux: "tmux" };
}

// --- the per-user config file -------------------------------------------------------

export interface UserConfig {
  schema: 1;
  multiplexer: Multiplexer | null;
  multiplexerAnsweredAt: number | null;
  /** Every other top-level key, kept verbatim on rewrite. */
  extra: Record<string, unknown>;
}

export type ConfigParse = { ok: true; config: UserConfig } | { ok: false; error: string };

export function emptyUserConfig(): UserConfig {
  return { schema: 1, multiplexer: null, multiplexerAnsweredAt: null, extra: {} };
}

/**
 * null (no file) or "" → an empty config. Not JSON, not an object, a schema
 * other than 1, a multiplexer other than "tmux", "herdr", null or absent, or an
 * answered-at time other than a finite number, null or absent → ok:false.
 */
export function parseUserConfig(text: string | null): ConfigParse {
  if (text === null || text === "") return { ok: true, config: emptyUserConfig() };
  const data = parseJson(text);
  if (!isRecord(data)) return { ok: false, error: "config.json is not a JSON object" };
  const { schema, multiplexer = null, multiplexerAnsweredAt = null, ...extra } = data;
  if (schema !== 1) return { ok: false, error: `config.json has schema ${JSON.stringify(schema)}, expected 1` };
  if (multiplexer !== null && multiplexer !== "tmux" && multiplexer !== "herdr") {
    return { ok: false, error: `config.json has multiplexer ${JSON.stringify(multiplexer)}; one of: tmux herdr` };
  }
  if (multiplexerAnsweredAt !== null && (typeof multiplexerAnsweredAt !== "number" || !Number.isFinite(multiplexerAnsweredAt))) {
    return { ok: false, error: `config.json has multiplexerAnsweredAt ${JSON.stringify(multiplexerAnsweredAt)}, expected a number` };
  }
  return { ok: true, config: { schema: 1, multiplexer, multiplexerAnsweredAt, extra } };
}

export function withMultiplexer(config: UserConfig, mux: Multiplexer, now: number): UserConfig {
  return { ...config, multiplexer: mux, multiplexerAnsweredAt: now };
}

/** Two-space JSON and a newline. The three named keys come first and win over any of the same name in `extra`. */
export function serializeUserConfig(config: UserConfig): string {
  const { schema: _schema, multiplexer: _multiplexer, multiplexerAnsweredAt: _answeredAt, ...extra } = config.extra;
  return `${JSON.stringify({ schema: config.schema, multiplexer: config.multiplexer, multiplexerAnsweredAt: config.multiplexerAnsweredAt, ...extra }, null, 2)}\n`;
}
