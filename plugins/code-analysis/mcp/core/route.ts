/**
 * route.ts — query -> intent -> capability -> arguments.
 *
 * Deterministic: no scoring, no counting, no model call. The rule table is ORDERED
 * and the first match wins, so the order is part of the contract and every ordering
 * decision in it is a test row.
 *
 * Matching is on WHOLE TOKENS, never substrings. Substring matching misroutes every
 * symbol that embeds a keyword: `Specification` is not `spec`, `DocumentStore` is not
 * `doc`, `ImpactReport` is not `impact`.
 *
 * Pure function of its input, and it must stay that way — no filesystem, no clock, no
 * process — because it is the one module a table test can cover exhaustively.
 */

import type { Capability } from "./capabilities";
import type { BackendNote, Scope } from "./ports";
import type { LimitSettings } from "./settings";

export type Intent =
  | "locate"
  | "understand"
  | "dependents"
  | "implementations"
  | "impact"
  | "knowledge";

export const INTENTS: readonly Intent[] = [
  "locate",
  "understand",
  "dependents",
  "implementations",
  "impact",
  "knowledge",
];

export interface IntentRule {
  /** Stable id, e.g. "impact.blast-radius". Named in tests and in `defaulted`. */
  id: string;
  intent: Intent;
  /** undefined = no match. A rule that identified the symbol reports it, so
   *  extractSymbolName does not have to re-derive it from a weaker heuristic. */
  match: (normalisedQuery: string, rawQuery: string) => { symbol?: string } | undefined;
}

export interface IntentInference {
  intent: Intent;
  rule: string | null;
  symbol?: string;
}

export interface ServedBy {
  engine: string;
  capability: Capability;
  substituted?: { requested: Capability; reason: string };
  defaulted?: string[];
}

export type RouteArgs =
  | { kind: "text"; text: string }
  | { kind: "name"; name: string }
  | { kind: "distance"; name: string; distance: number }
  | { kind: "maxDistance"; name: string; maxDistance: number };

export interface RouteInput {
  query: string;
  intent?: Intent;
  scope?: string;
  declared: ReadonlySet<Capability>;
  limits: LimitSettings;
  depth?: number; // tier-1 tools only; tier 0 never exposes it
  maxDepth?: number; // tier-1 tools only
  /** The engine that will serve this. RouteDecision carries a complete ServedBy and
   *  `route` has no other source for the name — it must not look one up, because a
   *  lookup is exactly how this module would stop being pure. */
  engine: string;
}

export interface RouteDecision {
  capability: Capability;
  requested: Capability;
  intent: Intent;
  intentRule: string | null;
  args: RouteArgs;
  scope: Scope;
  served: ServedBy;
}

export type RouteResult =
  | { ok: true; decision: RouteDecision }
  | { ok: false; note: BackendNote };

// ---------------------------------------------------------------------------
// Step 1 — normalise
// ---------------------------------------------------------------------------

/** Everything outside this set becomes a token boundary. `.` and `:` survive because
 *  they carry a qualified name (`User.Service`, `Auth::login`); `-` survives because
 *  it is ordinary inside a file or package name. */
const ALLOWED_CHARS = /[^A-Za-z0-9 _$./:-]+/gu;

const IDENT_PART = "[a-z_$][a-z0-9_$]*";
/** A bare or qualified identifier: `parse`, `parseConfig`, `User.Service`, `auth::login`. */
const QUALIFIED_IDENT = new RegExp(`^${IDENT_PART}(?:(?:\\.|::)${IDENT_PART})*$`, "u");
const MIN_SYMBOL_LENGTH = 3;

export function normaliseQuery(raw: string): string {
  return cleanRaw(raw).toLowerCase();
}

function cleanRaw(raw: string): string {
  return raw.normalize("NFKC").replace(ALLOWED_CHARS, " ").replace(/ +/gu, " ").trim();
}

function splitTokens(text: string): string[] {
  return text === "" ? [] : text.split(" ");
}

/** Normalised tokens paired with the raw tokens they came from, index for index. The
 *  raw form is what carries case and separators, and every shape test reads it. */
function tokenPairs(normalised: string, rawQuery: string): { tokens: string[]; raw: string[] } {
  const tokens = splitTokens(normalised);
  const raw = splitTokens(cleanRaw(rawQuery));
  // Alignment is guaranteed when `normalised` came from `rawQuery`. If a caller pairs
  // mismatched strings, degrade to the normalised form rather than misreport a symbol.
  return { tokens, raw: raw.length === tokens.length ? raw : tokens };
}

function containsPhrase(tokens: readonly string[], phrase: string): boolean {
  const want = splitTokens(phrase);
  if (want.length === 0 || want.length > tokens.length) return false;
  outer: for (let i = 0; i + want.length <= tokens.length; i += 1) {
    for (let j = 0; j < want.length; j += 1) {
      if (tokens[i + j] !== want[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 2 — the rule table
// ---------------------------------------------------------------------------

/**
 * Whole-token phrases per rule id. Exported because SYMBOL_STOPWORDS must be a
 * superset of every word here: a new pattern whose words are not stopwords would let
 * extractSymbolName step 4 return the pattern word itself as the symbol. The test
 * asserts the containment, so that mistake fails a build instead of misrouting.
 */
export const INTENT_RULE_PATTERNS: Readonly<Record<string, readonly string[]>> = {
  "impact.blast-radius": [
    "impact",
    "blast radius",
    "what breaks",
    "safe to change",
    "safe to delete",
    "safe to remove",
    "safe to rename",
    "if i change",
    "if i delete",
    "if i remove",
    "if i rename",
    "ripple",
  ],
  // `call`/`calls`/`called` are here because without them "where is parse called"
  // fell to the locate rules and step 4 answered with the symbol `called`.
  "dependents.callers": [
    "who calls",
    "what calls",
    "call",
    "calls",
    "called",
    "caller",
    "callers",
    "called by",
    // NOT a bare "reference": that swallowed "API reference for PaymentClient" and
    // "reference implementation of Store". Only the usage forms.
    "references to",
    "referenced by",
    "referencing",
    "used by",
    "usage",
    "usages",
    // Bare "depends on", not just "depends on this" — "what depends on Store" is the
    // canonical dependents question and was falling through to `understand`.
    //
    // It does NOT collide with the opposite question, because English conjugation
    // separates them: dependents ask "what DEPENDS ON X", dependencies ask "what does X
    // DEPEND ON". The third-person `s` is the discriminator, so matching "depends on"
    // leaves "depend on" alone. That is deliberate — there is no `dependencies` intent
    // (see the intent/capability mapping), so those queries correctly reach `understand`.
    "depends on",
    "reverse dependencies",
  ],
  "implementations.concrete": [
    "implementation",
    "implementations",
    "implements",
    "implementor",
    "implementors",
    "subclass",
    "subclasses",
    "concrete impl",
    "concrete type",
    "concrete class",
  ],
  "knowledge.docs": [
    "doc",
    "docs",
    "documentation",
    "readme",
    "changelog",
    "adr",
    "comment",
    "comments",
    "guide",
    "spec",
    "rationale",
    "design decision",
    "why do",
    "why does",
    "why is",
    "why are",
    "why did",
  ],
  // NOT a bare "find the": that captured "find the bug in auth flow" and turned it
  // into locateSymbol on a symbol named `flow`.
  "locate.phrase": [
    "where is",
    "definition of",
    "defined",
    "declared",
    "locate",
    "find the definition of",
    "find the declaration of",
    "find the source of",
    "find the body of",
  ],
};

/** Kind words for rule 6. A token here is never a symbol — it is also a stopword. */
export const SYMBOL_KIND_WORDS: readonly string[] = [
  "class",
  "interface",
  "function",
  "func",
  "method",
  "struct",
  "enum",
  "type",
  "trait",
  "protocol",
  "record",
];

const PHRASE_RULE_ORDER: readonly { id: string; intent: Intent }[] = [
  // 1 before 2: "what is the impact on the callers of parse" contains `callers`, and
  //             it is still an impact question.
  { id: "impact.blast-radius", intent: "impact" },
  // 2 before 5/6/7: "where is parse called" contains `where is`, and "who calls class
  //                 UserService" contains a kind word. Both are dependents questions.
  { id: "dependents.callers", intent: "dependents" },
  // 3 before 4: "docs for implementations of Store" is an implementations question.
  { id: "implementations.concrete", intent: "implementations" },
  { id: "knowledge.docs", intent: "knowledge" },
  // 5 before 6: both land on `locate`, so routing is identical either way; the order
  //             fixes which rule id gets reported, and the plainer signal wins.
  { id: "locate.phrase", intent: "locate" },
];

/** ORDERED. First match wins. The order is part of the contract. */
export const INTENT_RULES: readonly IntentRule[] = [
  ...PHRASE_RULE_ORDER.map(({ id, intent }): IntentRule => {
    const phrases = INTENT_RULE_PATTERNS[id] ?? [];
    return {
      id,
      intent,
      match: (normalised) => {
        const tokens = splitTokens(normalised);
        return phrases.some((p) => containsPhrase(tokens, p)) ? {} : undefined;
      },
    };
  }),
  {
    // 6. A symbol-kind word immediately followed by an identifier-shaped token.
    // "Find class UserService" is a structural question, and it gets a structural
    // answer on four of six engines. Routing it to text search is the degradation the
    // port exists to refuse, and worse coming from the facade than from a caller.
    // The plugin's own guidance used to say both things in different files; this rule
    // is the executable resolution, and the table test is where it is pinned.
    id: "locate.kind-identifier",
    intent: "locate",
    match: (normalised, rawQuery) => {
      const { tokens, raw } = tokenPairs(normalised, rawQuery);
      for (let i = 0; i < tokens.length - 1; i += 1) {
        const kind = tokens[i];
        const next = tokens[i + 1];
        const nextRaw = raw[i + 1];
        if (kind === undefined || next === undefined || nextRaw === undefined) continue;
        if (!SYMBOL_KIND_WORDS.includes(kind)) continue;
        // The token is never first here — it always follows a kind word — so an
        // uppercase at index 0 is real signal, unlike rule 7 where it is just
        // ordinary English capitalisation.
        if (isIdentifierShaped(next) && hasStructuralSignal(nextRaw, true)) {
          return { symbol: nextRaw };
        }
      }
      return undefined;
    },
  },
  {
    // 7. The whole query is one identifier-shaped token. Weakest signal, so last: it
    // must not pre-empt any phrase rule. The symbol falls out of extractSymbolName
    // step 3, so this rule stays a pure shape test.
    id: "locate.identifier-shape",
    intent: "locate",
    match: (normalised, rawQuery) => {
      const { tokens, raw } = tokenPairs(normalised, rawQuery);
      if (tokens.length !== 1) return undefined;
      const only = tokens[0];
      const onlyRaw = raw[0];
      if (only === undefined || onlyRaw === undefined) return undefined;
      return isIdentifierShaped(only) && hasStructuralSignal(onlyRaw, false) ? {} : undefined;
    },
  },
];

function isIdentifierShaped(normalisedToken: string): boolean {
  return normalisedToken.length >= MIN_SYMBOL_LENGTH && QUALIFIED_IDENT.test(normalisedToken);
}

/**
 * Does the raw token look deliberately named rather than like an English word?
 * `allowLeadingUpper` is false only for the query's FIRST token, where a capital is
 * ordinary sentence case and carries no signal — which is the single difference that
 * lets "find interface Store" match while "Specification" alone does not.
 */
function hasStructuralSignal(rawToken: string, allowLeadingUpper: boolean): boolean {
  if (rawToken.includes("_")) return true;
  if (rawToken.includes(".") || rawToken.includes(":")) return true;
  return /[A-Z]/u.test(allowLeadingUpper ? rawToken : rawToken.slice(1));
}

export function inferIntent(query: string): IntentInference {
  const normalised = normaliseQuery(query);
  for (const rule of INTENT_RULES) {
    const hit = rule.match(normalised, query);
    if (hit === undefined) continue;
    return hit.symbol === undefined
      ? { intent: rule.intent, rule: rule.id }
      : { intent: rule.intent, rule: rule.id, symbol: hit.symbol };
  }
  return { intent: "understand", rule: null };
}

// ---------------------------------------------------------------------------
// Step 3 — capability chain
// ---------------------------------------------------------------------------

/** Ordered fallbacks. Element 0 is the primary. */
export const INTENT_CAPABILITY_CHAIN: Readonly<Record<Intent, readonly Capability[]>> = {
  locate: ["locateSymbol", "generalSearch"],
  understand: ["generalSearch"],
  dependents: ["findDependents", "generalSearch"],
  implementations: ["findImplementations", "generalSearch"],
  impact: ["impact", "findDependents", "generalSearch"],
  knowledge: ["knowledgeSearch", "generalSearch"],
};

/** Capabilities whose argument is a symbol name. Routing skips one of these when the
 *  query names no symbol, rather than sending the engine a name it invented. */
const NAME_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "locateSymbol",
  "findDependencies",
  "findDependents",
  "callTree",
  "findImplementations",
  "impact",
]);

const NO_SYMBOL_REASON = "no symbol-shaped token in the query";

/** Fixed string per (requested, served) pair — never assembled from what an engine
 *  reported about itself, which would make the reason vary by engine vocabulary. */
const SUBSTITUTION_REASONS: Readonly<Record<string, string>> = {
  "locateSymbol->generalSearch": "this engine has no symbol table",
  "findDependents->generalSearch": "this engine has no call graph",
  "findDependencies->generalSearch": "this engine has no call graph",
  "callTree->generalSearch": "this engine has no call graph",
  "findImplementations->generalSearch": "this engine has no type hierarchy",
  "impact->findDependents":
    "this engine has no impact analysis; its direct dependents are the closest honest answer",
  "impact->generalSearch": "this engine has no call graph",
  "knowledgeSearch->generalSearch": "this engine indexes code only",
};

function substitutionReason(requested: Capability, served: Capability): string {
  return SUBSTITUTION_REASONS[`${requested}->${served}`] ?? `this engine has no ${requested}`;
}

/**
 * `Intent` is the tier-0 vocabulary and is deliberately coarser than `Capability`: it
 * names the shape of the question, and "what does X connect to" is one shape. That is
 * why the three graph capabilities all report `dependents` when a tier-1 tool fixes
 * the capability directly and no inference runs.
 */
const CAPABILITY_INTENT: Readonly<Record<Capability, Intent>> = {
  generalSearch: "understand",
  knowledgeSearch: "knowledge",
  locateSymbol: "locate",
  readSource: "locate",
  findDependencies: "dependents",
  findDependents: "dependents",
  callTree: "dependents",
  findImplementations: "implementations",
  impact: "impact",
};

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------

/** Interrogatives, articles, prepositions, plus every word used by a rule pattern or
 *  as a kind word. Step 4 may never return one of these. */
export const SYMBOL_STOPWORDS: ReadonlySet<string> = new Set<string>([
  ...[
    "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "been", "between",
    "but", "by", "can", "did", "do", "does", "done", "each", "else", "for", "from", "get",
    "has", "have", "here", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my",
    "no", "not", "of", "on", "one", "or", "our", "out", "over", "should", "so", "some",
    "than", "that", "the", "their", "then", "there", "these", "this", "those", "through",
    "to", "up", "us", "via", "was", "we", "were", "what", "when", "where", "which", "who",
    "whom", "why", "will", "with", "you", "your",
  ],
  ...Object.values(INTENT_RULE_PATTERNS).flatMap((phrases) =>
    phrases.flatMap((phrase) => splitTokens(phrase)),
  ),
  ...SYMBOL_KIND_WORDS,
]);

/** `inferred.symbol` wins outright when a rule captured one. */
export function extractSymbolName(query: string, inferred?: IntentInference): string | undefined {
  // 1. The rule that matched already knows which token it matched. Asking it beats
  //    re-deriving: for "Find class UserService" the shape heuristic would have to
  //    choose between `class` and `UserService`, and for "find interface Store" it
  //    would reject `Store` as ordinary sentence case.
  if (inferred?.symbol !== undefined) return inferred.symbol;

  // 2. An explicitly delimited span in the RAW query. The user marked it; take it whole.
  const delimited = /[`"']([^`"']+)[`"']/u.exec(query);
  const marked = delimited?.[1]?.trim();
  if (marked !== undefined && marked !== "") return marked;

  const normalised = normaliseQuery(query);
  const { tokens, raw } = tokenPairs(normalised, query);

  // 3. Shape. Longest qualifying token wins; ties break by first occurrence. A
  //    qualified name is returned whole — splitting it is the adapter's business.
  let best: { value: string; length: number } | undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const rawToken = raw[i];
    if (token === undefined || rawToken === undefined) continue;
    if (!isIdentifierShaped(token)) continue;
    if (!hasStructuralSignal(rawToken, i > 0)) continue;
    if (best === undefined || rawToken.length > best.length) {
      best = { value: rawToken, length: rawToken.length };
    }
  }
  if (best !== undefined) return best.value;

  // 4. Position — and ONLY when a rule fired. Most real symbols are lowercase, so
  //    "where is parse called" has no shape signal at all. Gating on a fired rule is
  //    what stops this guessing `auth` for "how does auth work": a conceptual question
  //    names no symbol, and inventing one sends generalSearch a worse query than the
  //    user's own words.
  if (inferred?.rule == null) return undefined;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    const rawToken = raw[i];
    if (token === undefined || rawToken === undefined) continue;
    if (!isIdentifierShaped(token)) continue;
    if (SYMBOL_STOPWORDS.has(token)) continue;
    return rawToken;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const DEFAULT_DEPTH = 1;
const DEFAULT_MAX_DEPTH = 3;
const GLOB_METACHARACTERS = /[*?[\]{}]/u;

/** Stand-in rule id for "the caller named the intent", used only to enable
 *  extractSymbolName step 4. Never reported as `intentRule`. */
const EXPLICIT_INTENT_RULE = "intent.explicit";

export function route(input: RouteInput): RouteResult {
  const defaulted: string[] = [];

  let intent: Intent;
  let inference: IntentInference | undefined;
  if (input.intent !== undefined) {
    // An explicitly supplied intent skips inference ENTIRELY — the rule table is not
    // consulted, so `rule` is null and nothing is defaulted.
    intent = input.intent;
  } else {
    inference = inferIntent(input.query);
    intent = inference.intent;
    if (inference.rule === null) {
      defaulted.push("intent=understand (inferred, no rule matched)");
    }
  }

  // Symbol extraction gets a hint even when the intent was explicit: naming the
  // question shape yourself is at least as strong a signal as a rule firing, and
  // without it `code_search({query:"parse", intent:"dependents"})` finds no symbol and
  // falls back to text search. The synthesised id never reaches `intentRule`, which
  // stays null because no rule ran.
  const hint: IntentInference = inference ?? { intent, rule: EXPLICIT_INTENT_RULE };
  const symbol = extractSymbolName(input.query, hint);
  const chain = INTENT_CAPABILITY_CHAIN[intent];
  const requested = chain[0];
  if (requested === undefined) {
    return { ok: false, note: unavailable(`no capability chain for intent "${intent}"`) };
  }

  let served: Capability | undefined;
  let skippedForSymbol = false;
  for (const candidate of chain) {
    if (!input.declared.has(candidate)) continue;
    if (NAME_CAPABILITIES.has(candidate) && symbol === undefined) {
      skippedForSymbol = skippedForSymbol || candidate === requested;
      continue;
    }
    served = candidate;
    break;
  }

  if (served === undefined) {
    return {
      ok: false,
      note: unavailable(
        `${input.engine || "no engine"} declares none of ${chain.join(", ")}, so this question has no honest answer here.`,
      ),
    };
  }

  const scope = resolveScope(input, defaulted);
  const args = buildArgs(served, input, symbol, defaulted);

  const servedBy: ServedBy = { engine: input.engine, capability: served };
  if (served !== requested) {
    servedBy.substituted = {
      requested,
      reason: skippedForSymbol ? NO_SYMBOL_REASON : substitutionReason(requested, served),
    };
  }
  if (defaulted.length > 0) servedBy.defaulted = defaulted;

  return {
    ok: true,
    decision: {
      capability: served,
      requested,
      intent,
      intentRule: inference?.rule ?? null,
      args,
      scope,
      served: servedBy,
    },
  };
}

/** Tier-1 entry point: the capability is fixed by the tool name, no inference. */
export function routeCapability(
  capability: Capability,
  input: Omit<RouteInput, "query" | "intent"> & { symbol: string },
): RouteResult {
  if (!input.declared.has(capability)) {
    // Reachable on the normal path, not just in theory: the host had the tool listed,
    // called it, and the probe that ran as part of that very call delisted it.
    return {
      ok: false,
      note: {
        level: "error",
        code: "capability_unsupported",
        message: `${input.engine || "this engine"} cannot answer ${capability} for this project.`,
      },
    };
  }

  const defaulted: string[] = [];
  const scope = resolveScope(input, defaulted);
  const args = buildArgs(capability, input, input.symbol, defaulted);
  const served: ServedBy = { engine: input.engine, capability };
  if (defaulted.length > 0) served.defaulted = defaulted;

  return {
    ok: true,
    decision: {
      capability,
      requested: capability,
      intent: CAPABILITY_INTENT[capability],
      intentRule: null,
      args,
      scope,
      served,
    },
  };
}

function buildArgs(
  capability: Capability,
  input: { query?: string; depth?: number; maxDepth?: number },
  symbol: string | undefined,
  defaulted: string[],
): RouteArgs {
  const name = symbol ?? "";
  switch (capability) {
    case "findDependencies":
    case "findDependents": {
      const distance = positiveOrDefault(input.depth, DEFAULT_DEPTH, "depth", defaulted);
      return { kind: "distance", name, distance };
    }
    case "callTree":
    case "impact": {
      const maxDistance = positiveOrDefault(
        input.maxDepth,
        DEFAULT_MAX_DEPTH,
        "max_depth",
        defaulted,
      );
      return { kind: "maxDistance", name, maxDistance };
    }
    case "locateSymbol":
    case "findImplementations":
      return { kind: "name", name };
    case "readSource":
      // Unreachable in 6.0.0: readSource is in no capability chain and has no tier-1
      // tool, so neither entry point can select it. It answers by name here so a
      // future caller gets the symbol rather than a text query it cannot use.
      return { kind: "name", name };
    default:
      // generalSearch / knowledgeSearch take the user's own words. Substituting an
      // extracted symbol here would hand a text engine a worse query than it was given.
      return { kind: "text", text: input.query ?? name };
  }
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
  key: string,
  defaulted: string[],
): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    defaulted.push(`${key}=${fallback}`);
    return fallback;
  }
  return Math.trunc(value);
}

function resolveScope(
  input: { scope?: string; limits: LimitSettings },
  defaulted: string[],
): Scope {
  const limit = Math.min(Math.max(input.limits.default, 1), Math.max(input.limits.max, 1));
  defaulted.push(`limit=${limit}`);

  const raw = input.scope?.trim();
  if (raw === undefined || raw === "") return { limit };

  // A bare path is a directory the caller meant to search under. Widening it is an
  // applied default, so it is announced rather than silently assumed.
  if (GLOB_METACHARACTERS.test(raw)) return { glob: raw, limit };
  const glob = `${raw.endsWith("/") ? raw.slice(0, -1) : raw}/**`;
  defaulted.push(`scope=${glob}`);
  return { glob, limit };
}

function unavailable(message: string): BackendNote {
  return {
    level: "error",
    code: "backend_unavailable",
    message,
    // The settings key is written out rather than imported, so route.ts keeps its
    // type-only dependency on settings.ts and stays a pure function of its input.
    remedy: 'Name an engine that declares this capability under "code-analysis".engine in .claude/settings.json.',
  };
}
