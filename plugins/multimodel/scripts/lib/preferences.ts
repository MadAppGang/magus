/**
 * Deterministic resolution of `.claude/multimodel-team.json` against a live catalog.
 *
 * WHY THIS IS CODE AND NOT PROSE
 * ------------------------------
 * "Always disclose whether the preferences file is out of date" is an *output
 * invariant*, not a judgement call. Measured over 30 benchmark runs, the shipped
 * skill prose produced that disclosure 0/15 times and the best rewritten prose
 * 14/15 — good, but no finite sample of a stochastic process can support "every
 * time". Everything here is computed, so the command can render it mechanically
 * and the skill prose only has to explain what it means.
 *
 * DESIGN RULES
 * ------------
 * 1. Every model-bearing field is verified: `defaultModels`,
 *    `contextPreferences[*]`, and `customAliases` values. `customAliases` was the
 *    only field the old skill checked, and it is the least likely to hold a dead
 *    ID — the file that motivated this had `customAliases: {}` and six dead IDs
 *    in `defaultModels`.
 * 2. A dead entry invalidates that entry, never the whole request. Drop it, keep
 *    the survivors, and let the caller proceed.
 * 3. Freshness is *reported*, never enforced. Age neither rejects a live model
 *    nor approves a dead one; catalog membership is the only thing that decides.
 * 4. `lastUpdated` is declared metadata, NOT the file's age. It is not maintained
 *    by every write path — a real file reported March while its own
 *    `history[0].date` said July. When the two disagree we say so and name both
 *    rather than picking whichever looks newer.
 * 5. The primary disclosure is the *measured* one: how many saved IDs the catalog
 *    no longer lists. That is derived from the comparison we just performed, so
 *    unlike a timestamp it cannot be silently wrong.
 */

/** The sentinel meaning "the host Claude model" — never sent to claudish, never validated. */
export const INTERNAL = "internal";

export type Prefs = {
  schemaVersion?: string;
  lastUpdated?: string;
  defaultModels?: string[];
  defaultThreshold?: string;
  contextPreferences?: Record<string, string[]>;
  customAliases?: Record<string, string>;
  agentPreferences?: Record<string, string>;
  history?: Array<{ date?: string; [k: string]: unknown }>;
};

export type Freshness = {
  /** Days since the file was last modified on disk, or null when unknown. */
  mtimeDays: number | null;
  /** Verbatim `lastUpdated`, or null. Declared metadata — never treated as the age. */
  declaredLastUpdated: string | null;
  /** Newest parseable `history[].date`, or null. */
  newestHistoryDate: string | null;
  /** False when `lastUpdated` predates the newest history entry (i.e. it was not maintained). */
  metadataConsistent: boolean;
  /** What an age claim, if any, may be sourced from. */
  ageSource: "mtime" | "unknown";
};

export type FieldVerdict = { kept: string[]; dropped: string[] };

export type Receipt = {
  prefsPath: string;
  exists: boolean;
  /** Set when the file is missing or unparseable; every other field is still safe to read. */
  error: string | null;
  freshness: Freshness;
  fields: {
    defaultModels: FieldVerdict;
    contextPreferences: Record<string, FieldVerdict>;
    customAliases: FieldVerdict;
  };
  /** Models to actually dispatch, for the requested context. `internal` is preserved. */
  selected: string[];
  /** Every distinct dead ID found anywhere in the file. */
  dropped: string[];
  /** Total distinct model IDs examined (excluding `internal`). */
  examined: number;
  /** True when the file named models but none of them survived. */
  exhausted: boolean;
  /**
   * False when the caller supplied no catalog. Everything is then passed through
   * UNVERIFIED — and the receipt must say so. Reporting "all IDs are live" after
   * checking nothing is the same defect as a green test that cannot fail.
   */
  catalogAvailable: boolean;
};

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Verify a list of model IDs against the catalog.
 * `internal` always survives — it denotes the host model, not a claudish model.
 */
function verify(ids: string[] | undefined, catalog: Set<string>): FieldVerdict {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of ids ?? []) {
    if (typeof id !== "string" || !id.trim()) continue;
    if (id === INTERNAL || catalog.has(id)) kept.push(id);
    else dropped.push(id);
  }
  return { kept, dropped };
}

export function computeFreshness(prefs: Prefs, mtime: Date | null, now: Date): Freshness {
  const declared = typeof prefs.lastUpdated === "string" ? prefs.lastUpdated : null;
  const declaredDate = parseDate(declared);

  let newestHistory: Date | null = null;
  for (const h of prefs.history ?? []) {
    const d = parseDate(h?.date);
    if (d && (!newestHistory || d > newestHistory)) newestHistory = d;
  }

  // `lastUpdated` is only "consistent" if it is not older than the newest thing the
  // file itself records having done. Older means a write path failed to stamp it.
  const metadataConsistent =
    !declaredDate || !newestHistory || declaredDate.getTime() >= newestHistory.getTime();

  return {
    mtimeDays: mtime ? Math.max(0, daysBetween(mtime, now)) : null,
    declaredLastUpdated: declared,
    newestHistoryDate: newestHistory ? newestHistory.toISOString().slice(0, 10) : null,
    metadataConsistent,
    ageSource: mtime ? "mtime" : "unknown",
  };
}

/**
 * Resolve preferences into a dispatchable model list plus a full receipt.
 *
 * `catalogIds` is the set of IDs the live catalog lists *right now*. An EMPTY
 * catalog is treated as "could not verify", not "everything is dead" — failing
 * closed here would discard a working configuration because a lookup failed.
 */
export function resolve(opts: {
  prefsPath: string;
  prefs: Prefs | null;
  parseError?: string | null;
  mtime: Date | null;
  catalogIds: string[];
  context?: string;
  now?: Date;
}): Receipt {
  const now = opts.now ?? new Date();
  const prefs = opts.prefs ?? {};
  const catalog = new Set(opts.catalogIds.filter((s) => typeof s === "string" && s.trim()));
  const catalogUnavailable = catalog.size === 0;

  const freshness = computeFreshness(prefs, opts.mtime, now);

  const contextPreferences: Record<string, FieldVerdict> = {};
  for (const [k, v] of Object.entries(prefs.contextPreferences ?? {})) {
    contextPreferences[k] = catalogUnavailable
      ? { kept: (v ?? []).slice(), dropped: [] }
      : verify(v, catalog);
  }

  const defaultModels = catalogUnavailable
    ? { kept: (prefs.defaultModels ?? []).slice(), dropped: [] }
    : verify(prefs.defaultModels, catalog);

  const aliasTargets = Object.values(prefs.customAliases ?? {});
  const customAliases = catalogUnavailable
    ? { kept: aliasTargets.slice(), dropped: [] }
    : verify(aliasTargets, catalog);

  // Selection order mirrors the command: context preference first, then defaults.
  const ctx = opts.context && contextPreferences[opts.context];
  const source = ctx && (ctx.kept.length || ctx.dropped.length) ? ctx : defaultModels;
  const selected = source.kept;

  const dropped = [
    ...new Set([
      ...defaultModels.dropped,
      ...Object.values(contextPreferences).flatMap((f) => f.dropped),
      ...customAliases.dropped,
    ]),
  ];

  const examined = new Set(
    [
      ...(prefs.defaultModels ?? []),
      ...Object.values(prefs.contextPreferences ?? {}).flat(),
      ...aliasTargets,
    ].filter((id) => typeof id === "string" && id && id !== INTERNAL),
  ).size;

  return {
    prefsPath: opts.prefsPath,
    exists: opts.prefs !== null,
    error: opts.parseError ?? null,
    freshness,
    fields: { defaultModels, contextPreferences, customAliases },
    selected,
    dropped,
    examined,
    catalogAvailable: !catalogUnavailable,
    // "Named models but none survived" — not the same as "named no models at all".
    exhausted:
      !catalogUnavailable &&
      examined > 0 &&
      selected.filter((m) => m !== INTERNAL).length === 0,
  };
}

/**
 * Render the receipt for a human. This is the line the command prints; the model
 * never has to remember to produce it.
 */
export function render(r: Receipt): string {
  // Order matters: a file that exists but will not parse is a DIFFERENT disclosure
  // from no file at all. Reporting "none" for a corrupt file would hide a real
  // problem behind a benign-sounding message.
  if (r.error) return `Preferences: ${r.prefsPath} could not be read (${r.error}) — using live catalog only.`;
  if (!r.exists) return `Preferences: none at ${r.prefsPath} — using live catalog only.`;

  const lines: string[] = [];

  // Primary disclosure: the measured count. Cannot be silently wrong.
  if (r.examined === 0) {
    lines.push(`Preferences: ${r.prefsPath} names no models.`);
  } else if (!r.catalogAvailable) {
    // Never claim a verification that did not happen.
    lines.push(
      `Preferences: ${r.examined} saved model IDs could NOT be verified — the live ` +
        `catalog was unavailable. Proceeding unverified; any of these may be decommissioned.`,
    );
  } else if (r.dropped.length === 0) {
    lines.push(`Preferences: all ${r.examined} saved model IDs are still in the live catalog.`);
  } else {
    lines.push(
      `Preferences: ${r.dropped.length} of ${r.examined} saved model IDs are no longer ` +
        `in the live catalog — ${r.dropped.join(", ")}.`,
    );
  }

  // Secondary, and always labelled with its source.
  const f = r.freshness;
  if (f.ageSource === "mtime" && f.mtimeDays !== null) {
    lines.push(`File modified ${f.mtimeDays} day${f.mtimeDays === 1 ? "" : "s"} ago (filesystem mtime).`);
  } else {
    lines.push(`File freshness unknown.`);
  }
  if (!f.metadataConsistent) {
    lines.push(
      `Freshness metadata inconsistent: lastUpdated=${f.declaredLastUpdated} but ` +
        `newest history entry=${f.newestHistoryDate}. Neither is used to accept or reject a model.`,
    );
  }

  lines.push(
    r.selected.length
      ? `Using: ${r.selected.join(", ")}.`
      : `No saved model survived verification.`,
  );
  return lines.join("\n");
}
