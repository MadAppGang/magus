/**
 * Typed configuration, parsed once at boot.
 *
 * Environment variables are the boundary people skip, and the consequence is the worst
 * kind of failure: the service starts fine and breaks an hour later on the first request
 * that touches a mistyped variable. Parsing at boot converts that incident into a failed
 * deploy — an orchestrator will not shift traffic to a container that never became ready.
 *
 * Deliberately dependency-free. A schema library (zod, valibot) is a fine substitute; the
 * point is that SOMETHING parses, and that `process.env` is read in exactly one file.
 */

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** A parser converts a raw string (or undefined) into a typed value, or explains why not. */
export type Parser<T> = (raw: string | undefined, key: string) => T;

const missing = (key: string): never => {
  throw new Error(`${key} is required but not set`);
};

export const str = (options: { default?: string; allowEmpty?: boolean } = {}): Parser<string> =>
  (raw, key) => {
    // An unset variable and an empty one are different mistakes; treating `FOO=` as
    // "set" is how an empty DATABASE_URL reaches a connection call.
    if (raw === undefined || (raw === "" && !options.allowEmpty)) {
      return options.default ?? missing(key);
    }
    return raw;
  };

export const num = (options: { default?: number; min?: number; max?: number; int?: boolean } = {}): Parser<number> =>
  (raw, key) => {
    if (raw === undefined || raw === "") return options.default ?? missing(key);
    const value = Number(raw);
    // Number("") is 0 and Number("12abc") is NaN — both must fail loudly, not coerce.
    if (!Number.isFinite(value)) throw new Error(`${key} must be a number, got ${JSON.stringify(raw)}`);
    if (options.int && !Number.isInteger(value)) throw new Error(`${key} must be an integer, got ${raw}`);
    if (options.min !== undefined && value < options.min) throw new Error(`${key} must be >= ${options.min}, got ${value}`);
    if (options.max !== undefined && value > options.max) throw new Error(`${key} must be <= ${options.max}, got ${value}`);
    return value;
  };

/**
 * Booleans are where silent misconfiguration lives: `Boolean("false")` is `true`, so a
 * naive parse turns `DEBUG=false` into debug mode. Only an explicit vocabulary is accepted.
 */
const TRUE = new Set(["true", "1", "yes", "on"]);
const FALSE = new Set(["false", "0", "no", "off"]);

export const bool = (options: { default?: boolean } = {}): Parser<boolean> =>
  (raw, key) => {
    if (raw === undefined || raw === "") return options.default ?? missing(key);
    const normalized = raw.trim().toLowerCase();
    if (TRUE.has(normalized)) return true;
    if (FALSE.has(normalized)) return false;
    throw new Error(`${key} must be one of true/false/1/0/yes/no/on/off, got ${JSON.stringify(raw)}`);
  };

export const oneOf = <const T extends readonly string[]>(values: T, options: { default?: T[number] } = {}): Parser<T[number]> =>
  (raw, key) => {
    if (raw === undefined || raw === "") return options.default ?? missing(key);
    if (!values.includes(raw)) throw new Error(`${key} must be one of ${values.join(" | ")}, got ${JSON.stringify(raw)}`);
    return raw as T[number];
  };

export const url = (options: { default?: string; protocols?: readonly string[] } = {}): Parser<string> =>
  (raw, key) => {
    if (raw === undefined || raw === "") return options.default ?? missing(key);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`${key} must be a valid URL, got ${JSON.stringify(raw)}`);
    }
    if (options.protocols && !options.protocols.includes(parsed.protocol)) {
      throw new Error(`${key} must use one of ${options.protocols.join(", ")}, got ${parsed.protocol}`);
    }
    return raw;
  };

/** Comma-separated list — the usual shape for allow-lists and origins. */
export const list = (options: { default?: readonly string[]; separator?: string } = {}): Parser<readonly string[]> =>
  (raw, key) => {
    if (raw === undefined || raw === "") return options.default ?? missing(key);
    const items = raw
      .split(options.separator ?? ",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) throw new Error(`${key} must contain at least one entry`);
    return items;
  };

export type Schema = Record<string, Parser<unknown>>;
export type Config<S extends Schema> = { readonly [K in keyof S]: ReturnType<S[K]> };

/**
 * Parse the whole schema, collecting EVERY failure before throwing.
 *
 * Failing on the first bad variable means a misconfigured deploy takes one round trip per
 * mistake. Reporting all of them at once is the difference between one restart and five.
 */
export function parseEnv<S extends Schema>(schema: S, source: Record<string, string | undefined> = Bun.env): Config<S> {
  const out: Record<string, unknown> = {};
  const issues: string[] = [];

  for (const [key, parse] of Object.entries(schema)) {
    try {
      out[key] = parse(source[key], key);
    } catch (err) {
      issues.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (issues.length > 0) throw new ConfigError(issues);
  // Frozen so a later `config.PORT = …` is a visible error rather than action at a distance.
  return Object.freeze(out) as Config<S>;
}

/**
 * Example schema. Replace with yours; the shape is the point.
 *
 * Usage — note this runs at import time, so a bad value crashes at BOOT:
 *   export const config = parseEnv(appSchema);
 */
export const appSchema = {
  NODE_ENV: oneOf(["development", "test", "production"] as const, { default: "development" }),
  PORT: num({ default: 3000, int: true, min: 1, max: 65535 }),
  LOG_LEVEL: oneOf(["debug", "info", "warn", "error"] as const, { default: "info" }),
  DATABASE_URL: url({ protocols: ["postgres:", "postgresql:", "file:", "sqlite:"] }),
  ALLOWED_ORIGINS: list({ default: [] }),
  REQUEST_TIMEOUT_MS: num({ default: 10_000, int: true, min: 100 }),
  ENABLE_METRICS: bool({ default: false }),
} satisfies Schema;
