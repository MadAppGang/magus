/**
 * Tests for intent inference and routing.
 *
 * Every row asserts the TRIPLE (intent, rule, symbol), not just the intent: a query
 * that lands on the right intent via the wrong rule is a latent regression, and the
 * symbol column is the only thing that exercises all four extractSymbolName steps.
 *
 * The first three rows are the plugin's oldest routing contradiction made executable.
 * Its guidance used to route "Find class UserService" to text search in one file while
 * three other files called that exact substitution an anti-pattern. Rule 6 settles it: a
 * symbol-kind word plus an identifier is a structural question with a structural
 * answer, and answering it with text search is the degradation the port exists to
 * refuse. Row 3 is the guard on that — rule 6 must not fire on an English sentence
 * that happens to contain the word `class`.
 *
 * Run: bun test plugins/code-analysis/mcp/core/route.test.ts
 */

import { describe, expect, test } from "bun:test";
import type { Capability } from "./capabilities";
import {
  extractSymbolName,
  inferIntent,
  INTENT_CAPABILITY_CHAIN,
  INTENT_RULE_PATTERNS,
  INTENT_RULES,
  INTENTS,
  normaliseQuery,
  route,
  routeCapability,
  SYMBOL_KIND_WORDS,
  SYMBOL_STOPWORDS,
  type Intent,
} from "./route";
import type { LimitSettings } from "./settings";

const LIMITS: LimitSettings = { default: 20, max: 200 };

/** Declared capability sets, straight off the design's engine grid. */
const GRID: Readonly<Record<string, readonly Capability[]>> = {
  mnemex: [
    "generalSearch",
    "knowledgeSearch",
    "locateSymbol",
    "readSource",
    "findDependencies",
    "findDependents",
    "callTree",
    "impact",
  ],
  enginea: [
    "generalSearch",
    "locateSymbol",
    "readSource",
    "findDependencies",
    "findDependents",
    "callTree",
    "impact",
  ],
  serena: ["generalSearch", "locateSymbol", "readSource", "findDependents", "findImplementations"],
  engineb: [
    "generalSearch",
    "knowledgeSearch",
    "locateSymbol",
    "findDependencies",
    "findDependents",
    "callTree",
    "findImplementations",
  ],
  enginec: ["generalSearch", "knowledgeSearch"],
  engined: ["generalSearch", "knowledgeSearch"],
};

function declared(engine: keyof typeof GRID): ReadonlySet<Capability> {
  return new Set(GRID[engine] ?? []);
}

function triple(query: string): { intent: Intent; rule: string | null; symbol?: string } {
  const inferred = inferIntent(query);
  const symbol = extractSymbolName(query, inferred);
  return { intent: inferred.intent, rule: inferred.rule, symbol };
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const ROWS: readonly [string, Intent, string | null, string | undefined][] = [
  ["Find class UserService", "locate", "locate.kind-identifier", "UserService"],
  ["find interface Store", "locate", "locate.kind-identifier", "Store"],
  ["what class handles retries", "understand", null, undefined],
  ["where is parse called", "dependents", "dependents.callers", "parse"],
  ["who calls class UserService", "dependents", "dependents.callers", "UserService"],
  // The canonical dependents phrasing. It used to fall through to `understand`, because
  // the rule carried only "depends on this".
  ["what depends on Store", "dependents", "dependents.callers", "Store"],
  // The MIRROR question, kept as a guard: English conjugation is the only thing keeping
  // these two apart. "depends on" (third person) is the dependents question; "depend on"
  // is the dependencies question, which has no intent of its own and must stay on
  // `understand` with rule null. If someone loosens the pattern to bare "depend", the
  // intent flips to `dependents` and this row goes red.
  //
  // The symbol IS still resolved here, and that is correct: extractSymbolName works off
  // token shape, not off the rule, so an unrouted query can still name its subject. Only
  // the intent/rule pair distinguishes the two questions.
  ["what does Store depend on", "understand", null, "Store"],
  ["docs for implementations of Store", "implementations", "implementations.concrete", "Store"],
  // The design's table has no knowledge row; without one, rule 4 ships uncovered.
  ["docs for PaymentClient", "knowledge", "knowledge.docs", "PaymentClient"],
  ["what is the impact on the callers of parse", "impact", "impact.blast-radius", "parse"],
  ["where is class Store defined", "locate", "locate.phrase", "Store"],
  ["parseConfig", "locate", "locate.identifier-shape", "parseConfig"],
  ["how does auth work", "understand", null, undefined],
];

describe("intent inference — the table", () => {
  for (const [query, intent, rule, symbol] of ROWS) {
    test(`"${query}" -> ${intent} / ${rule ?? "null"} / ${symbol ?? "no symbol"}`, () => {
      expect(triple(query)).toEqual({ intent, rule, symbol });
    });
  }

  test("every rule id in the table has at least one row", () => {
    const covered = new Set(ROWS.map(([, , rule]) => rule).filter((r): r is string => r !== null));
    expect([...covered].sort()).toEqual(INTENT_RULES.map((r) => r.id).sort());
  });
});

describe("ordering is load-bearing", () => {
  // 1 before 2: the query contains `callers` and is still an impact question.
  test("impact beats dependents", () => {
    expect(triple("what is the impact on the callers of parse").rule).toBe("impact.blast-radius");
    expect(triple("is it safe to delete resolveEngine").intent).toBe("impact");
    expect(triple("what breaks if i rename parse").rule).toBe("impact.blast-radius");
  });

  // 2 before 5, 6 and 7: both of these would otherwise be caught by a locate rule.
  test("dependents beats every locate rule", () => {
    expect(triple("where is parse called").rule).toBe("dependents.callers");
    expect(triple("who calls class UserService").rule).toBe("dependents.callers");
  });

  // 3 before 4: "docs for implementations of Store" is an implementations question.
  test("implementations beats knowledge", () => {
    expect(triple("docs for implementations of Store").rule).toBe("implementations.concrete");
  });

  // 5 before 6: both land on `locate`, so only the reported rule id differs. The
  // plainer signal is the one reported.
  test("the locate phrase beats the kind-identifier shape", () => {
    expect(triple("where is class Store defined").rule).toBe("locate.phrase");
  });

  // 6 before 7: rule 6 is multi-token and rule 7 requires a single token, so they
  // cannot both fire. Ordering them makes that explicit rather than incidental.
  test("rule 6 and rule 7 cannot both fire", () => {
    expect(triple("Find class UserService").rule).toBe("locate.kind-identifier");
    expect(triple("UserService").rule).toBe("locate.identifier-shape");
  });

  test("the rule table is declared in the contract's order", () => {
    expect(INTENT_RULES.map((r) => r.id)).toEqual([
      "impact.blast-radius",
      "dependents.callers",
      "implementations.concrete",
      "knowledge.docs",
      "locate.phrase",
      "locate.kind-identifier",
      "locate.identifier-shape",
    ]);
  });
});

describe("whole-token matching, never substrings", () => {
  test("Specification is not spec, DocumentStore is not doc, ImpactReport is not impact", () => {
    expect(triple("what is Specification").intent).toBe("understand");
    expect(triple("DocumentStore")).toEqual({
      intent: "locate",
      rule: "locate.identifier-shape",
      symbol: "DocumentStore",
    });
    expect(triple("ImpactReport")).toEqual({
      intent: "locate",
      rule: "locate.identifier-shape",
      symbol: "ImpactReport",
    });
  });

  test("a bare `reference` is not a dependents question", () => {
    // Narrowed to the usage forms, or this swallows both of these.
    expect(triple("API reference for PaymentClient").intent).toBe("understand");
    expect(triple("reference implementation of Store").rule).toBe("implementations.concrete");
    expect(triple("show me the references to parse").rule).toBe("dependents.callers");
  });

  test("a bare `find the` does not invent a symbol", () => {
    // These used to become locateSymbol on symbols named `flow` and `pipeline`.
    expect(triple("find the bug in auth flow")).toEqual({
      intent: "understand",
      rule: null,
      symbol: undefined,
    });
    expect(triple("find the bottleneck in pipeline")).toEqual({
      intent: "understand",
      rule: null,
      symbol: undefined,
    });
    expect(triple("find the definition of parse").rule).toBe("locate.phrase");
  });
});

describe("rule 6 shape test", () => {
  const cases: readonly [string, string | undefined][] = [
    ["find class UserService", "UserService"],
    ["find interface Store", "Store"], // uppercase at index 0 counts after a kind word
    ["find type user_service", "user_service"],
    ["find class User.Service", "User.Service"], // qualified, returned whole
    ["find method Auth::login", "Auth::login"],
    ["find method auth::login", "auth::login"], // the separator alone is enough
    ["what class handles retries", undefined], // no signal at all
  ];

  for (const [query, symbol] of cases) {
    test(`"${query}" -> ${symbol ?? "no match"}`, () => {
      const inferred = inferIntent(query);
      if (symbol === undefined) {
        expect(inferred.rule).not.toBe("locate.kind-identifier");
      } else {
        expect(inferred.rule).toBe("locate.kind-identifier");
        expect(inferred.symbol).toBe(symbol);
      }
    });
  }
});

describe("extractSymbolName", () => {
  test("step 1 — a rule's own capture wins outright", () => {
    // The heuristic would have to choose between `class` and `UserService` here.
    expect(extractSymbolName("Find class UserService", inferIntent("Find class UserService"))).toBe(
      "UserService",
    );
    // …and `class` never qualifies on its own: all lowercase at step 3, a stopword at 4.
    expect(SYMBOL_STOPWORDS.has("class")).toBe(true);
  });

  test("step 2 — a delimited span beats shape", () => {
    expect(extractSymbolName("what about `parse` in RegistryBuilder")).toBe("parse");
    expect(extractSymbolName('what about "parse"')).toBe("parse");
  });

  test("step 3 — longest qualifying token, ties by first occurrence", () => {
    expect(extractSymbolName("compare PaymentClient and Store")).toBe("PaymentClient");
    expect(extractSymbolName("compare Store and Cache")).toBe("Store");
    // An uppercase at index 0 of the FIRST token is ordinary sentence case, not signal.
    expect(extractSymbolName("Where things live")).toBeUndefined();
  });

  test("step 4 — position, and only when a rule fired", () => {
    expect(extractSymbolName("where is parse called", inferIntent("where is parse called"))).toBe(
      "parse",
    );
    // No rule fired: a conceptual question names no symbol, and guessing `auth` would
    // send generalSearch a worse query than the user's own words.
    expect(extractSymbolName("how does auth work", inferIntent("how does auth work"))).toBeUndefined();
    // Without an inference at all, step 4 is unavailable by construction.
    expect(extractSymbolName("where is parse called")).toBeUndefined();
  });

  test("undefined when nothing qualifies", () => {
    expect(extractSymbolName("what is going on")).toBeUndefined();
  });

  test("the stopword list covers every word any rule pattern uses", () => {
    // Adding a rule pattern without adding its words is a test failure here rather
    // than a silent misroute, where step 4 answers with the pattern word itself.
    const words = [
      ...Object.values(INTENT_RULE_PATTERNS).flatMap((phrases) =>
        phrases.flatMap((phrase) => phrase.split(" ")),
      ),
      ...SYMBOL_KIND_WORDS,
    ];
    expect(words.filter((word) => !SYMBOL_STOPWORDS.has(word))).toEqual([]);
  });
});

describe("normalisation and determinism", () => {
  test("normaliseQuery lowercases, strips and collapses", () => {
    expect(normaliseQuery("  Find  CLASS\tUserService()  ")).toBe("find class userservice");
    expect(normaliseQuery("`parse`")).toBe("parse");
    expect(normaliseQuery("User.Service and Auth::login")).toBe("user.service and auth::login");
  });

  test("the same query returns the same rule on 100 consecutive runs", () => {
    const ids = new Set<string | null>();
    for (let i = 0; i < 100; i += 1) ids.add(inferIntent("where is parse called").rule);
    expect([...ids]).toEqual(["dependents.callers"]);
  });

  test("every intent has a chain whose last element is generalSearch", () => {
    for (const intent of INTENTS) {
      const chain = INTENT_CAPABILITY_CHAIN[intent];
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[chain.length - 1]).toBe("generalSearch");
    }
  });
});

// ---------------------------------------------------------------------------
// route()
// ---------------------------------------------------------------------------

describe("route", () => {
  test("serves the primary capability when the engine declares it", () => {
    const result = route({
      query: "who calls resolveEngine",
      declared: declared("mnemex"),
      limits: LIMITS,
      engine: "mnemex",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.capability).toBe("findDependents");
    expect(result.decision.intentRule).toBe("dependents.callers");
    expect(result.decision.args).toEqual({
      kind: "distance",
      name: "resolveEngine",
      distance: 1,
    });
    expect(result.decision.served.substituted).toBeUndefined();
  });

  test("falls back down the chain and names a fixed reason", () => {
    const cases: readonly [keyof typeof GRID, string, Capability, Capability, string][] = [
      [
        "enginec",
        "who calls parse",
        "findDependents",
        "generalSearch",
        "this engine has no call graph",
      ],
      [
        "engined",
        "Find class UserService",
        "locateSymbol",
        "generalSearch",
        "this engine has no symbol table",
      ],
      [
        "engineb",
        "what is the impact of changing UserService",
        "impact",
        "findDependents",
        "this engine has no impact analysis; its direct dependents are the closest honest answer",
      ],
      [
        "enginea",
        "docs for the retry policy",
        "knowledgeSearch",
        "generalSearch",
        "this engine indexes code only",
      ],
      [
        "mnemex",
        "implementations of Store",
        "findImplementations",
        "generalSearch",
        "this engine has no type hierarchy",
      ],
      [
        "serena",
        "who calls UserService",
        "findDependents",
        "findDependents",
        "", // serena declares it: no substitution at all
      ],
    ];

    for (const [engine, query, requested, capability, reason] of cases) {
      const result = route({ query, declared: declared(engine), limits: LIMITS, engine });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.decision.requested).toBe(requested);
      expect(result.decision.capability).toBe(capability);
      if (reason === "") {
        expect(result.decision.served.substituted).toBeUndefined();
      } else {
        expect(result.decision.served.substituted).toEqual({ requested, reason });
      }
    }
  });

  test("skips a name-taking capability when the query names no symbol", () => {
    const result = route({
      query: "who calls it",
      declared: declared("mnemex"),
      limits: LIMITS,
      engine: "mnemex",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.capability).toBe("generalSearch");
    expect(result.decision.served.substituted?.reason).toBe("no symbol-shaped token in the query");
    // The engine gets the user's own words, not an invented name.
    expect(result.decision.args).toEqual({ kind: "text", text: "who calls it" });
  });

  test("an engine declaring nothing is a success-shaped failure, never a throw", () => {
    const result = route({
      query: "anything",
      declared: new Set<Capability>(),
      limits: LIMITS,
      engine: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note.code).toBe("backend_unavailable");
    expect(result.note.level).toBe("error");
    expect(result.note.remedy).toBeDefined();
  });

  test("an explicit intent skips inference entirely", () => {
    const result = route({
      query: "where is parse called", // would infer `dependents`
      intent: "knowledge",
      declared: declared("mnemex"),
      limits: LIMITS,
      engine: "mnemex",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.intent).toBe("knowledge");
    expect(result.decision.capability).toBe("knowledgeSearch");
    expect(result.decision.intentRule).toBeNull();
    expect(result.decision.served.defaulted).not.toContain(
      "intent=understand (inferred, no rule matched)",
    );
  });

  test("an inference that lands on the default says so", () => {
    const result = route({
      query: "how does auth work",
      declared: declared("mnemex"),
      limits: LIMITS,
      engine: "mnemex",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.served.defaulted).toContain(
      "intent=understand (inferred, no rule matched)",
    );
  });

  test("Scope.limit is never undefined, and every applied default is reported", () => {
    const result = route({
      query: "who calls parse",
      scope: "plugins/code-analysis",
      declared: declared("mnemex"),
      limits: LIMITS,
      engine: "mnemex",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.scope.limit).toBe(20);
    // A path with no glob metacharacter is widened, and the widening is announced.
    expect(result.decision.scope.glob).toBe("plugins/code-analysis/**");
    expect(result.decision.served.defaulted).toContain("scope=plugins/code-analysis/**");
    expect(result.decision.served.defaulted).toContain("limit=20");
    expect(result.decision.served.defaulted).toContain("depth=1");
  });

  test("a scope that is already a glob is passed through verbatim", () => {
    const result = route({
      query: "how does auth work",
      scope: "src/**/*.ts",
      declared: declared("mnemex"),
      limits: LIMITS,
      engine: "mnemex",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.scope.glob).toBe("src/**/*.ts");
    expect(result.decision.served.defaulted).not.toContain("scope=src/**/*.ts");
  });
});

describe("routeCapability", () => {
  test("fixes the capability by tool name and runs no inference", () => {
    const result = routeCapability("callTree", {
      symbol: "parse",
      maxDepth: 4,
      declared: declared("mnemex"),
      limits: LIMITS,
      engine: "mnemex",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.intentRule).toBeNull();
    expect(result.decision.args).toEqual({ kind: "maxDistance", name: "parse", maxDistance: 4 });
    expect(result.decision.served.defaulted).not.toContain("max_depth=3");
  });

  test("a delisted capability answers, and answers capability_unsupported", () => {
    // The normal path, not a corner: the probe that ran as part of this very call is
    // what delisted the tool the host had listed a moment ago.
    const result = routeCapability("impact", {
      symbol: "parse",
      declared: declared("serena"),
      limits: LIMITS,
      engine: "serena",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note.code).toBe("capability_unsupported");
    expect(result.note.message).toContain("serena");
  });
});
