import { describe, test, expect } from "bun:test";
import { parseEnv, ConfigError, str, num, bool, oneOf, url, list, appSchema } from "./env";

describe("str", () => {
  test("reads a value and applies a default when unset", () => {
    expect(parseEnv({ A: str() }, { A: "hello" }).A).toBe("hello");
    expect(parseEnv({ A: str({ default: "fallback" }) }, {}).A).toBe("fallback");
  });

  test("an EMPTY variable is treated as unset — `FOO=` is a mistake, not a value", () => {
    // This is how an empty DATABASE_URL reaches a connection call.
    expect(() => parseEnv({ A: str() }, { A: "" })).toThrow(ConfigError);
    expect(parseEnv({ A: str({ allowEmpty: true }) }, { A: "" }).A).toBe("");
  });

  test("a required-but-missing variable names itself in the error", () => {
    expect(() => parseEnv({ DATABASE_URL: str() }, {})).toThrow(/DATABASE_URL is required/);
  });
});

describe("num", () => {
  test("parses and applies bounds", () => {
    expect(parseEnv({ PORT: num() }, { PORT: "8080" }).PORT).toBe(8080);
    expect(parseEnv({ PORT: num({ default: 3000 }) }, {}).PORT).toBe(3000);
  });

  test("rejects junk instead of coercing — Number('12abc') is NaN", () => {
    expect(() => parseEnv({ PORT: num() }, { PORT: "12abc" })).toThrow(/must be a number/);
    expect(() => parseEnv({ PORT: num() }, { PORT: "abc" })).toThrow(/must be a number/);
  });

  test("an empty string does NOT become 0 — Number('') is 0, which is the trap", () => {
    expect(() => parseEnv({ PORT: num() }, { PORT: "" })).toThrow(/required/);
    expect(parseEnv({ PORT: num({ default: 3000 }) }, { PORT: "" }).PORT).toBe(3000);
  });

  test("enforces min, max and integerness", () => {
    expect(() => parseEnv({ P: num({ min: 1 }) }, { P: "0" })).toThrow(/>= 1/);
    expect(() => parseEnv({ P: num({ max: 65535 }) }, { P: "70000" })).toThrow(/<= 65535/);
    expect(() => parseEnv({ P: num({ int: true }) }, { P: "1.5" })).toThrow(/must be an integer/);
  });

  test("rejects Infinity", () => {
    expect(() => parseEnv({ P: num() }, { P: "Infinity" })).toThrow(/must be a number/);
  });
});

describe("bool", () => {
  test("accepts the usual truthy and falsy spellings", () => {
    for (const raw of ["true", "TRUE", "1", "yes", "on", " true "]) {
      expect(parseEnv({ F: bool() }, { F: raw }).F).toBe(true);
    }
    for (const raw of ["false", "FALSE", "0", "no", "off", " false "]) {
      expect(parseEnv({ F: bool() }, { F: raw }).F).toBe(false);
    }
  });

  test("DEBUG=false is FALSE — Boolean('false') would be true, which is the bug", () => {
    expect(parseEnv({ DEBUG: bool() }, { DEBUG: "false" }).DEBUG).toBe(false);
  });

  test("rejects an ambiguous value rather than guessing", () => {
    expect(() => parseEnv({ F: bool() }, { F: "maybe" })).toThrow(/must be one of/);
  });
});

describe("oneOf", () => {
  test("accepts a listed value and narrows the type", () => {
    const config = parseEnv({ ENV: oneOf(["development", "production"] as const) }, { ENV: "production" });
    const env: "development" | "production" = config.ENV; // compile-time proof of narrowing
    expect(env).toBe("production");
  });

  test("rejects an unlisted value and lists the alternatives", () => {
    expect(() => parseEnv({ ENV: oneOf(["dev", "prod"] as const) }, { ENV: "staging" })).toThrow(/dev \| prod/);
  });
});

describe("url", () => {
  test("accepts a valid URL and rejects a bare string", () => {
    expect(parseEnv({ U: url() }, { U: "https://a.test/x" }).U).toBe("https://a.test/x");
    expect(() => parseEnv({ U: url() }, { U: "not-a-url" })).toThrow(/must be a valid URL/);
  });

  test("can restrict the protocol", () => {
    expect(() => parseEnv({ U: url({ protocols: ["postgres:"] }) }, { U: "http://x.test" })).toThrow(/must use one of/);
    expect(parseEnv({ U: url({ protocols: ["postgres:"] }) }, { U: "postgres://h/db" }).U).toBe("postgres://h/db");
  });
});

describe("list", () => {
  test("splits, trims and drops empties", () => {
    expect(parseEnv({ L: list() }, { L: "a, b ,c" }).L).toEqual(["a", "b", "c"]);
    expect(parseEnv({ L: list() }, { L: "a,,b," }).L).toEqual(["a", "b"]);
  });

  test("an empty default is respected, but an all-separator value is an error", () => {
    expect(parseEnv({ L: list({ default: [] }) }, {}).L).toEqual([]);
    expect(() => parseEnv({ L: list() }, { L: ",,," })).toThrow(/at least one entry/);
  });
});

describe("parseEnv", () => {
  test("collects EVERY failure — one restart per deploy, not one per mistake", () => {
    const err = (() => {
      try {
        parseEnv({ A: str(), B: num(), C: bool() }, { B: "abc", C: "maybe" });
      } catch (e) {
        return e as ConfigError;
      }
    })();

    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.issues).toHaveLength(3);
    expect(err!.message).toContain("A is required");
    expect(err!.message).toContain("B must be a number");
    expect(err!.message).toContain("C must be one of");
  });

  test("the result is frozen — config must not be mutated at runtime", () => {
    const config = parseEnv({ PORT: num({ default: 3000 }) }, {});
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as { PORT: number }).PORT = 9999;
    }).toThrow();
  });

  test("ignores variables not in the schema — the process env is full of noise", () => {
    const config = parseEnv({ PORT: num({ default: 3000 }) }, { PORT: "8080", PATH: "/usr/bin", HOME: "/root" });
    expect(Object.keys(config)).toEqual(["PORT"]);
  });

  test("does not read the real process env when a source is supplied", () => {
    // Tests that touch the real environment are order-dependent and leak between files.
    expect(parseEnv({ PATH: str({ default: "unset" }) }, {}).PATH).toBe("unset");
  });
});

describe("appSchema", () => {
  test("boots with sane defaults when only the required variable is present", () => {
    const config = parseEnv(appSchema, { DATABASE_URL: "postgres://localhost/app" });
    expect(config).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      ALLOWED_ORIGINS: [],
      REQUEST_TIMEOUT_MS: 10_000,
      ENABLE_METRICS: false,
    });
  });

  test("fails at boot when the one required variable is absent", () => {
    expect(() => parseEnv(appSchema, {})).toThrow(/DATABASE_URL is required/);
  });

  test("rejects a DATABASE_URL with the wrong protocol", () => {
    expect(() => parseEnv(appSchema, { DATABASE_URL: "http://localhost/app" })).toThrow(/must use one of/);
  });
});
