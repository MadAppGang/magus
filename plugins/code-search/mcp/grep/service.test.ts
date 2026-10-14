import { describe, expect, test } from "bun:test";
import type { Hit } from "../core/ports";
import type { GrepConfig, GrepPort, GrepReason, GrepRequest, OracleBin } from "./service";
import { GREP_DECODE_BUDGET_BYTES, GREP_ENGINE_SLOTS, GREP_PAUSE_MAX_MS, makeGrepService, SERVER_DEADLINE_MS, spellPath } from "./service";

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const PROJECT = "/p";
const OLD = 1_000;
const NOW = 100_000;

interface Fs {
  /** Text, or raw bytes for a file that is not valid UTF-8. */
  files: Record<string, string | Uint8Array>;
  dirs: string[];
}

interface Harness {
  service: ReturnType<typeof makeGrepService>;
  calls: { engine: { pattern: string; limit: number; glob?: string }[]; walk: { args: readonly string[]; roots: readonly string[]; cwd: string; bin: OracleBin }[]; read: string[] };
  log: string[];
}

function hit(file: string, rawLine?: number): Hit {
  return { file, line: rawLine ?? 1, ...(rawLine === undefined ? {} : { rawLine }), score: 1 } as unknown as Hit;
}

function harness(options: {
  fs?: Fs;
  hits?: Hit[];
  listed?: string[];
  gate?: () => string | undefined | Promise<string | undefined>;
  oracleBin?: OracleBin | null;
  ppid?: number;
  /** Port members that replace the fake's (a delayed realpath, a real clock, …). */
  port?: Partial<GrepPort>;
} = {}): Harness {
  const fs: Fs = options.fs ?? { files: {}, dirs: [PROJECT] };
  const calls: Harness["calls"] = { engine: [], walk: [], read: [] };
  const log: string[] = [];
  const isDir = (p: string) => fs.dirs.includes(p);
  const port: GrepPort = {
    async engineSearch(q) {
      calls.engine.push(q);
      return { kind: "ok", hits: options.hits ?? [], lineBase: 1, notes: [] };
    },
    async walk(q) {
      calls.walk.push(q);
      return { kind: "done", paths: options.listed ?? Object.keys(fs.files), elapsedMs: 1 };
    },
    async readCandidate(abs) {
      calls.read.push(abs);
      const text = fs.files[abs];
      if (text === undefined) return { kind: "missing" };
      const id = { dev: 1, ino: abs.length, size: text.length, mtimeMs: OLD };
      return { kind: "ok", bytes: typeof text === "string" ? encode(text) : text, before: id, after: id };
    },
    async realpath(p) {
      const norm = p.replace(/\/\.$/u, "").replace(/\/$/u, "") || "/";
      return isDir(norm) || fs.files[norm] !== undefined ? norm : undefined;
    },
    async statBin(p) {
      if (isDir(p)) return { regular: false, executable: true, uid: 501 };
      return fs.files[p] !== undefined ? { regular: true, executable: false, uid: 501 } : undefined;
    },
    ppid: () => options.ppid ?? 42,
    uid: () => 501,
    now: () => NOW,
    sleep: () => new Promise<void>(() => undefined),
    ...options.port,
  };
  const config: GrepConfig = {
    projectReal: PROJECT,
    client: { isPermanentlyUnready: () => false, streak: () => 0 },
    log: (line) => log.push(line),
    ...(options.oracleBin === null ? {} : { oracleBin: options.oracleBin ?? { path: "/bin/claude", argv0: "rg" } }),
    ...(options.gate === undefined ? {} : { gate: options.gate }),
  };
  return { service: makeGrepService(port, config), calls, log };
}

function bash(argv: string[], cwd = PROJECT): GrepRequest {
  return { ppid: 42, callerPid: 7, cwd, receivedAt: NOW, input: { kind: "bash", argv } };
}

function tool(json: unknown, cwd = PROJECT): GrepRequest {
  return { ppid: 42, callerPid: 8, cwd, receivedAt: NOW, input: { kind: "tool", json } };
}

const TREE: Fs = {
  dirs: [PROJECT, "/p/src", "/p/lib"],
  files: {
    "/p/src/a.ts": "const x = fetchUser();\n",
    "/p/src/b.ts": "import x\n  return loadProfile(id);\n",
    "/p/lib/c.ts": "export const c = 1;\n",
  },
};

async function reasonOf(h: Harness, req: GrepRequest): Promise<GrepReason> {
  return (await h.service.handle(req)).reason;
}

describe("gates, before any I/O", () => {
  test("a closed gate answers gate_closed first, even for a foreign ppid", async () => {
    const h = harness({ fs: TREE, gate: () => "route-off" });
    expect(await h.service.handle({ ...bash(["-rn", "fetchUser", "."]), ppid: 99 })).toEqual({ payload: new Uint8Array(), reason: "gate_closed" });
    expect(h.calls).toEqual({ engine: [], walk: [], read: [] });
    expect(h.log).toEqual(["merge 7 bash - gate_closed engine=-1 oracle=-1 read=-1 extras=0"]);
  });

  test("a gate that throws is closed", async () => {
    const h = harness({ fs: TREE, gate: () => { throw new Error("boom"); } });
    expect(await reasonOf(h, bash(["-rn", "fetchUser", "."]))).toBe("gate_closed");
  });

  test("identity, argv, offset, oracle_unavailable, outside and file_target", async () => {
    expect(await reasonOf(harness({ fs: TREE }), { ...bash(["-rn", "fetchUser", "."]), ppid: 43 })).toBe("identity");
    expect(await reasonOf(harness({ fs: TREE, ppid: 1 }), { ...bash(["-rn", "fetchUser", "."]), ppid: 1 })).toBe("identity");
    expect(await reasonOf(harness({ fs: TREE }), bash(["-c", "fetchUser", "."]))).toBe("argv");
    expect(await reasonOf(harness({ fs: TREE }), tool({ pattern: "fetchUser", offset: 5 }))).toBe("offset");
    expect(await reasonOf(harness({ fs: TREE, oracleBin: null }), bash(["-rn", "fetchUser", "."]))).toBe("oracle_unavailable");
    expect(await reasonOf(harness({ fs: TREE }), bash(["-rn", "fetchUser", "."], "/elsewhere"))).toBe("outside");
    expect(await reasonOf(harness({ fs: TREE }), bash(["-rn", "fetchUser", "/etc"]))).toBe("outside");
    expect(await reasonOf(harness({ fs: TREE }), tool({ pattern: "fetchUser", path: "/p/src/a.ts" }))).toBe("file_target");
  });
});

describe("the merge", () => {
  test("bash content: the oracle runs from the project root over absolute roots; the block names the engine-only hit", async () => {
    const h = harness({ fs: TREE, hits: [hit("src/a.ts", 1), hit("src/b.ts", 2), hit("lib/c.ts", 1)] });
    const { payload, reason } = await h.service.handle(bash(["-rn", "fetchUser", "src/"]));
    expect(reason).toBe("appended");
    expect(decode(payload)).toBe(
      "--- code-search: 1 related location from the code index; none of these lines contains \"fetchUser\" ---\n" +
        "src/b.ts:2: return loadProfile(id);\n--- end code-search ---\n",
    );
    expect(h.calls.engine).toEqual([{ pattern: "fetchUser", limit: 20, glob: "src/**" }]);
    expect(h.calls.walk).toHaveLength(1);
    expect(h.calls.walk[0]).toMatchObject({ cwd: PROJECT, roots: ["/p/src"], bin: { path: "/bin/claude", argv0: "rg" } });
    expect(h.calls.walk[0]?.args.slice(0, 2)).toEqual(["--hidden", "--no-require-git"]);
    expect(h.log.at(-1)).toMatch(/^merge 7 bash content appended engine=\d+ oracle=\d+ read=\d+ extras=1$/u);
  });

  test("tool files mode with no path: paths relative to the cwd, no engine glob at the root", async () => {
    const h = harness({ fs: TREE, hits: [hit("src/a.ts"), hit("lib/c.ts")] });
    const { payload, reason } = await h.service.handle(tool({ pattern: "fetchUser" }));
    expect(reason).toBe("appended");
    expect(decode(payload)).toBe(
      "--- code-search: 1 related file from the code index; none of these files contains \"fetchUser\" ---\nlib/c.ts\n--- end code-search ---\n",
    );
    expect(h.calls.engine).toEqual([{ pattern: "fetchUser", limit: 20 }]);
  });

  test("`.` spells ./x; two roots each spell their own files", async () => {
    const h = harness({ fs: TREE, hits: [hit("src/b.ts"), hit("lib/c.ts")] });
    const one = await h.service.handle(bash(["-rl", "fetchUser", "."]));
    expect(decode(one.payload)).toContain("\n./src/b.ts\n./lib/c.ts\n");
    const two = await h.service.handle(bash(["-rl", "fetchUser", "lib", "src/"]));
    expect(decode(two.payload)).toContain("\nsrc/b.ts\nlib/c.ts\n");
  });

  test("a file the oracle did not list is never read or offered", async () => {
    const h = harness({ fs: TREE, hits: [hit("lib/c.ts")], listed: ["/p/src/a.ts"] });
    expect(await reasonOf(h, bash(["-rl", "fetchUser", "."]))).toBe("no_extras");
    expect(h.calls.read).toEqual([]);
  });

  test("no hit inside the roots: no_candidates, and no walk", async () => {
    const h = harness({ fs: TREE, hits: [hit("lib/c.ts")] });
    expect(await reasonOf(h, bash(["-rl", "fetchUser", "src"]))).toBe("no_candidates");
    expect(h.calls.walk).toEqual([]);
  });

  test("a bash file root is searched; its hit is spelled as the operand", async () => {
    const h = harness({ fs: TREE, hits: [hit("lib/c.ts")] });
    const { payload } = await h.service.handle(bash(["-rl", "fetchUser", "lib/c.ts"]));
    expect(decode(payload)).toContain("\nlib/c.ts\n");
    expect(h.calls.engine).toEqual([{ pattern: "fetchUser", limit: 20 }]);
  });

  test("a failed walk answers oracle_unavailable", async () => {
    const failing = makeGrepService(
      {
        ...({} as GrepPort),
        engineSearch: async () => ({ kind: "ok", hits: [hit("lib/c.ts")], lineBase: 1, notes: [] }),
        walk: async () => ({ kind: "failed" }),
        readCandidate: async () => ({ kind: "missing" }),
        realpath: async (p) => (p === PROJECT || p === "/p/." ? PROJECT : undefined),
        statBin: async () => ({ regular: false, executable: true, uid: 501 }),
        ppid: () => 42, uid: () => 501, now: () => NOW, sleep: () => new Promise<void>(() => undefined),
      },
      { projectReal: PROJECT, oracleBin: { path: "/usr/bin/rg" }, client: { isPermanentlyUnready: () => false, streak: () => 0 } },
    );
    expect((await failing.handle(bash(["-rl", "fetchUser", "."]))).reason).toBe("oracle_unavailable");
  });
});

describe("candidate drop before planning (P6 step 11)", () => {
  // The files ugrep `-I` skips: each offers nothing in either mode.
  const DROPPED: readonly (readonly [string, string | Uint8Array])[] = [
    ["a NUL byte", "const a = 1;\0\nreturn loadProfile(id);\n"],
    ["the byte 0xff", new Uint8Array([0x61, 0x0a, 0xff, 0x0a])],
    ["zero bytes", ""],
    ["a UTF-8 BOM alone", new Uint8Array([0xef, 0xbb, 0xbf])],
  ];
  const ORDINARY = "export const c = 1;\n";

  function tree(odd: string | Uint8Array, withOrdinary: boolean): Fs {
    return {
      dirs: [PROJECT, "/p/src"],
      files: { "/p/src/odd.ts": odd, ...(withOrdinary ? { "/p/src/ok.ts": ORDINARY } : {}) },
    };
  }

  for (const [name, bytes] of DROPPED) {
    for (const flag of ["-rl", "-rn"] as const) {
      test(`${name}, ${flag === "-rl" ? "files" : "content"} mode: alone → no_extras`, async () => {
        const h = harness({ fs: tree(bytes, false), hits: [hit("src/odd.ts", 1)] });
        expect(await reasonOf(h, bash([flag, "fetchUser", "src"]))).toBe("no_extras");
        expect(h.calls.read).toEqual(["/p/src/odd.ts"]);
      });

      test(`${name}, ${flag === "-rl" ? "files" : "content"} mode: beside an ordinary file → appended, naming only that file`, async () => {
        const h = harness({ fs: tree(bytes, true), hits: [hit("src/odd.ts", 1), hit("src/ok.ts", 1)] });
        const { payload, reason } = await h.service.handle(bash([flag, "fetchUser", "src"]));
        expect(reason).toBe("appended");
        const text = decode(payload);
        expect(text).toContain("src/ok.ts");
        expect(text).not.toContain("odd.ts");
      });
    }
  }

  test("a file with one line and no final newline is not dropped", async () => {
    const h = harness({ fs: tree("x", false), hits: [hit("src/odd.ts", 1)] });
    expect(await reasonOf(h, bash(["-rl", "fetchUser", "src"]))).toBe("appended");
  });
});

describe("a Bash call with no path operand (D6, P0-5)", () => {
  test("roots [] is the request cwd: the walk runs over the cwd's realpath and paths carry no ./", async () => {
    const h = harness({ fs: TREE, hits: [hit("src/b.ts", 2), hit("lib/c.ts", 1)] });
    const { payload, reason } = await h.service.handle(bash(["-rn", "fetchUser"], "/p/src"));
    expect(reason).toBe("appended");
    expect(decode(payload)).toContain("\nb.ts:2: return loadProfile(id);\n");
    expect(decode(payload)).not.toContain("c.ts");
    expect(h.calls.walk[0]).toMatchObject({ cwd: PROJECT, roots: ["/p/src"] });
    expect(h.calls.engine).toEqual([{ pattern: "fetchUser", limit: 20, glob: "src/**" }]);
  });

  test("the walk gets the D7 Bash-route args", async () => {
    const h = harness({ fs: TREE, hits: [hit("lib/c.ts")] });
    await h.service.handle(bash(["-rl", "--include=*.ts", "fetchUser"]));
    expect(h.calls.walk[0]?.args).toEqual([
      "--hidden", "--no-require-git", "--no-ignore-dot", "--no-ignore-exclude", "--no-ignore-global", "--no-ignore-parent",
      "--glob", "!.git", "--glob", "!.svn", "--glob", "!.hg", "--glob", "!.bzr", "--glob", "!.jj", "--glob", "!.sl",
      "--type-add", "csinc:*.ts", "--type", "csinc",
    ]);
    expect(h.calls.walk[0]?.roots).toEqual([PROJECT]);
  });
});

describe("spellPath", () => {
  test.each([
    [undefined, "a.ts", "a.ts"],
    [".", "a.ts", "./a.ts"],
    ["./", "a.ts", "./a.ts"],
    ["src/", "a.ts", "src/a.ts"],
    ["src//", "x/a.ts", "src/x/a.ts"],
    ["/abs/p", "a.ts", "/abs/p/a.ts"],
    ["lib/c.ts", "", "lib/c.ts"],
  ] as const)("spellPath(%s, %s)", (operand, rest, expected) => {
    expect(spellPath(operand, rest)).toBe(expected);
  });
});

// Review round 4, Codex HIGH: the 1400 ms deadline was armed only after the cwd and root
// realpath/stat work, so a slow filesystem ran the request past it (measured: 1653 ms).
describe("the deadline covers the path checks", () => {
  test("a realpath that takes 1650 ms: the request answers deadline within SERVER_DEADLINE_MS", async () => {
    const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
    const h = harness({
      fs: TREE,
      port: {
        now: () => Date.now(),
        sleep: realSleep,
        realpath: (p) => new Promise((resolve) => setTimeout(() => resolve(p.replace(/\/\.$/u, "")), 1_650)),
      },
    });
    const started = Date.now();
    const result = await h.service.handle({ ...bash(["-rn", "fetchUser", "."]), receivedAt: started });
    const took = Date.now() - started;
    expect(result.reason).toBe("deadline");
    expect(took).toBeLessThan(SERVER_DEADLINE_MS + 150);
    expect(h.calls.engine).toEqual([]);
  });
});

// Review round 4, Codex HIGH: pump() launched queued flights without looking at the
// pause the flight before it had just armed, so every queued request reached an
// unavailable engine and the pause doubled to its cap (measured: 8 calls, 600000 ms).
describe("queued flights recheck the merge's own state", () => {
  test("8 queued requests against an unavailable engine: at most the slots' worth of calls, the rest paused", async () => {
    let calls = 0;
    const h = harness({
      fs: TREE,
      port: {
        engineSearch: async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { kind: "unavailable", note: { level: "error", code: "backend_unavailable", message: "down" } };
        },
      },
    });
    const words = ["alphaWord", "betaWord", "gammaWord", "deltaWord", "epsilonWord", "zetaWord", "etaWord", "thetaWord"];
    const reasons = await Promise.all(words.map((w) => reasonOf(h, bash(["-rn", w, "."]))));
    expect(calls).toBeLessThanOrEqual(GREP_ENGINE_SLOTS);
    expect(reasons.filter((r) => r === "unavailable")).toHaveLength(calls);
    expect(reasons.filter((r) => r === "paused")).toHaveLength(words.length - calls);
    expect(h.service.state().pauseMs).toBeLessThan(GREP_PAUSE_MAX_MS);
  });
});

// Review round 6, Codex HIGH (measured): every candidate's line table was built and kept
// until planning, so 20 newline-dense 2 MB files took the server from 15 to 427 MiB RSS.
// Candidates are now planned one at a time in rank order and released, decoding stops at
// GREP_DECODE_BUDGET_BYTES, and planning stops at EXTRAS_MAX.
describe("candidate memory is bounded", () => {
  const DENSE = "a\n".repeat(1_000_000); // 2,000,000 bytes, one million lines
  const files: Record<string, string> = {};
  const hits: Hit[] = [];
  for (let i = 0; i < 20; i += 1) {
    files[`/p/d/f${i}.ts`] = DENSE;
    hits.push(hit(`d/f${i}.ts`, 1));
  }

  test("20 newline-dense 2 MB candidates: decoding stops at the budget, RSS stays bounded, inside the deadline", async () => {
    let peak = 0;
    let reads = 0;
    const h = harness({
      fs: { dirs: [PROJECT, "/p/d"], files },
      hits,
      port: {
        now: () => Date.now(),
        sleep: realSleep,
        readCandidate: async (abs) => {
          reads += 1;
          peak = Math.max(peak, process.memoryUsage().rss);
          const text = files[abs];
          if (text === undefined) return { kind: "missing" };
          const id = { dev: 1, ino: abs.length, size: text.length, mtimeMs: OLD };
          return { kind: "ok", bytes: encode(text), before: id, after: id };
        },
      },
    });
    // A full collection first, so the baseline holds no garbage of earlier tests (Bun.gc;
    // reached through globalThis because this project type-checks without Bun globals).
    (globalThis as unknown as { Bun?: { gc(force: boolean): void } }).Bun?.gc(true);
    const base = process.memoryUsage().rss;
    const started = Date.now();
    const result = await h.service.handle({ ...bash(["-rn", "fetchUser", "d"]), receivedAt: started });
    peak = Math.max(peak, process.memoryUsage().rss);
    expect(Date.now() - started).toBeLessThan(SERVER_DEADLINE_MS);
    expect(result.reason).toBe("appended");
    // Reads stop once the next file would pass the decode budget.
    expect(reads).toBeLessThanOrEqual(Math.floor(GREP_DECODE_BUDGET_BYTES / DENSE.length) + 1);
    expect((peak - base) / 2 ** 20).toBeLessThan(150);
  }, 20_000);

  test("a normal case: the same block as planning every candidate at once", async () => {
    const h = harness({ fs: TREE, hits: [hit("src/a.ts", 1), hit("src/b.ts", 2), hit("lib/c.ts", 1)] });
    const { payload } = await h.service.handle(bash(["-rn", "fetchUser", "."]));
    expect(decode(payload)).toBe(
      "--- code-search: 2 related locations from the code index; none of these lines contains \"fetchUser\" ---\n" +
        "./src/b.ts:2: return loadProfile(id);\n./lib/c.ts:1: export const c = 1;\n--- end code-search ---\n",
    );
  });
});

/** A real timer for `port.sleep`, so the request's deadline fires on the wall clock. */
function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

const later = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

// Review round 5, Codex HIGH + internal MEDIUM: the candidate loop's realpath and read
// were awaited outside the deadline race (measured: 3004 ms against 1400; a realpath that
// never settles held the request forever).
describe("the deadline covers the candidate reads", () => {
  const CANDIDATE = "/p/src/b.ts";
  const slowCandidate = (realpath: (p: string) => Promise<string | undefined>) =>
    harness({
      fs: TREE,
      hits: [hit("src/a.ts", 1), hit("src/b.ts", 2)],
      port: {
        now: () => Date.now(),
        sleep: realSleep,
        realpath: (p) => (p === CANDIDATE ? realpath(p) : Promise.resolve(p.replace(/\/\.$/u, "").replace(/\/$/u, "") || "/")),
      },
    });

  test.each([
    ["delayed 3 s", (p: string) => later<string | undefined>(3_000, p)],
    ["never settling", () => never<string | undefined>()],
  ] as const)("a candidate realpath %s: deadline within SERVER_DEADLINE_MS", async (_label, realpath) => {
    const h = slowCandidate(realpath);
    const started = Date.now();
    const result = await h.service.handle({ ...bash(["-rn", "fetchUser", "src/"]), receivedAt: started });
    expect(result.reason).toBe("deadline");
    expect(Date.now() - started).toBeLessThan(SERVER_DEADLINE_MS + 150);
  }, 10_000);

  test("a candidate read that never settles: deadline within SERVER_DEADLINE_MS", async () => {
    const h = harness({
      fs: TREE,
      hits: [hit("src/b.ts", 2)],
      port: { now: () => Date.now(), sleep: realSleep, readCandidate: () => never() },
    });
    const started = Date.now();
    const result = await h.service.handle({ ...bash(["-rn", "fetchUser", "src/"]), receivedAt: started });
    expect(result.reason).toBe("deadline");
    expect(Date.now() - started).toBeLessThan(SERVER_DEADLINE_MS + 150);
  }, 10_000);
});

// Review round 5, Codex HIGH: the deadline was armed after the merge gate, whose
// production reader did synchronous stat/read (measured: an injected 1650 ms gate stall
// answered after 1651 ms). The gate may now be asynchronous and runs inside the deadline.
describe("the deadline covers the merge gate", () => {
  test("a gate that takes 1650 ms: deadline within SERVER_DEADLINE_MS, nothing else touched", async () => {
    const h = harness({
      fs: TREE,
      gate: () => later<string | undefined>(1_650, undefined),
      port: { now: () => Date.now(), sleep: realSleep },
    });
    const started = Date.now();
    const result = await h.service.handle({ ...bash(["-rn", "fetchUser", "."]), receivedAt: started });
    expect(result.reason).toBe("deadline");
    expect(Date.now() - started).toBeLessThan(SERVER_DEADLINE_MS + 150);
    expect(h.calls).toEqual({ engine: [], walk: [], read: [] });
  }, 10_000);

  test("an asynchronous gate: closed is gate_closed, a rejection is gate_closed, open merges", async () => {
    const req = bash(["-rn", "fetchUser", "."]);
    expect(await reasonOf(harness({ fs: TREE, gate: async () => "route-off" }), req)).toBe("gate_closed");
    expect(await reasonOf(harness({ fs: TREE, gate: () => Promise.reject(new Error("boom")) }), req)).toBe("gate_closed");
    expect(await reasonOf(harness({ fs: TREE, gate: async () => undefined }), req)).toBe("no_candidates");
  });
});

// Review round 5, Codex MEDIUM: racing resolveRoots bounded the answer but not the work:
// with 16 roots and the first realpath delayed 1650 ms, all 33 realpath/stat calls still
// ran after the request had answered deadline.
describe("a lost deadline race stops the root resolution", () => {
  test("16 roots, the first realpath delayed 1650 ms: no root work after the deadline", async () => {
    const dirs = Array.from({ length: 16 }, (_, i) => `/p/d${i}`);
    const fs: Fs = { dirs: [PROJECT, ...dirs], files: {} };
    const work: string[] = [];
    const h = harness({
      fs,
      port: {
        now: () => Date.now(),
        sleep: realSleep,
        realpath: (p) => {
          work.push(`realpath ${p}`);
          return p === "/p/d0" ? later<string | undefined>(1_650, p) : Promise.resolve(p);
        },
        statBin: async (p) => {
          work.push(`stat ${p}`);
          return dirs.includes(p) ? { regular: false, executable: true, uid: 501 } : undefined;
        },
      },
    });
    const started = Date.now();
    const operands = dirs.map((d) => d.slice(PROJECT.length + 1));
    const result = await h.service.handle({ ...bash(["-rn", "fetchUser", ...operands]), receivedAt: started });
    expect(result.reason).toBe("deadline");
    await new Promise((resolve) => setTimeout(resolve, 1_900 - (Date.now() - started)));
    expect(work).toEqual(["realpath /p", "realpath /p/d0"]);
  }, 10_000);
});
