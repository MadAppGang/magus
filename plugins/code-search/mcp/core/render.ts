/**
 * render.ts — structured records to text. ONE format, every engine, every capability.
 *
 * Nothing else in the server writes result text. That is what makes truncation
 * principled and what keeps `mapText`-shaped blobs — a string field meaning "whatever
 * the engine rendered" — out of the port.
 *
 * Two rules are contract rather than taste, and both are about honesty:
 *   - an ABSENT field renders as nothing. No `rel=?`, no `centrality=n/a`. The port's
 *     "omission is distinguishable from low" survives into the text only if the
 *     renderer refuses to fill gaps.
 *   - `served_by:` is the first non-banner line, always. It is greppable, and it
 *     teaches the routing table by example on every call at near-zero cost.
 *
 * This is also the ONE core module allowed to name `BackendHealth.detail`, and the one
 * allowed to touch `Ranked.evidence` — generically, via Object.entries, never by key.
 */

import type { BackendNote, CodeLocation, Hit, Outcome } from "./ports";
import type { ServedBy } from "./route";
import type { FacadeHealth } from "./health";

export interface EmissionLedger {
  seen(key: string): boolean;
  mark(key: string): void;
  size(): number;
}

/** Process-lifetime = session-lifetime: Claude Code spawns one server per session. */
export function makeLedger(): EmissionLedger {
  const seen = new Set<string>();
  return {
    seen: (key) => seen.has(key),
    mark: (key) => void seen.add(key),
    size: () => seen.size,
  };
}

export function locationKey(at: CodeLocation): string {
  return `${at.file}:${at.line}-${at.endLine ?? at.line}`;
}

export interface RenderOptions {
  ledger: EmissionLedger;
  maxTextLines: number; // default 40
  showEvidence: boolean; // default FALSE
  budgetHint?: string;
}

export const DEFAULT_MAX_TEXT_LINES = 40;

/** Mandatory closing clause. A bare staleness warning with no "the rest is fine"
 *  poisons trust in the whole payload, which costs more than the warning buys. */
const STALE_CLOSING = "! every file NOT named above is fresh; trust the rest of this response.";

const REPEAT_POINTER =
  "↑ already sent earlier in this conversation — this is a pointer, not a gap. " +
  "Scroll up rather than re-Reading.";

const TEXT_INDENT = "      ";

export function renderOutcome(o: Outcome<Hit>, served: ServedBy, opts: RenderOptions): string {
  const referenced = new Set(o.results.map((hit) => hit.file));
  const stale = staleFiles(o.notes);
  const staleAbove = stale.filter((file) => referenced.has(file));
  const staleBelow = stale.filter((file) => !referenced.has(file));

  const lines: string[] = [];
  if (staleAbove.length > 0) {
    for (const file of staleAbove) lines.push(`! STALE (referenced below): ${file}`);
    lines.push("");
  }

  lines.push(servedByLine(served));
  lines.push("");

  if (o.results.length === 0) {
    lines.push("no results.");
    const explained = o.notes.some((note) => note.level !== "info");
    if (!explained) {
      lines.push("the engine answered and found nothing (this is not an error).");
    }
  } else {
    o.results.forEach((hit, index) => {
      lines.push(...renderHit(hit, index + 1, opts));
    });
  }

  const truncation = truncationLine(o);
  if (truncation !== undefined) {
    lines.push("");
    lines.push(truncation);
  }

  const notes = renderNotes(o.notes);
  if (notes !== "") {
    lines.push("");
    lines.push(notes);
  }

  if (staleBelow.length > 0) {
    lines.push("");
    for (const file of staleBelow) lines.push(`! stale, not referenced above: ${file}`);
  }
  if (stale.length > 0) {
    if (staleBelow.length === 0) lines.push("");
    lines.push(STALE_CLOSING);
  }

  if (opts.budgetHint !== undefined && opts.budgetHint !== "") {
    lines.push("");
    lines.push(opts.budgetHint);
  }

  return `${lines.join("\n")}\n`;
}

export function renderUnavailable(served: Partial<ServedBy>, note: BackendNote): string {
  const head = `served_by: ${served.engine ?? "none"}/${served.capability ?? "none"}  (not served — ${note.code.replace(/_/gu, " ")})`;
  return `${head}\n\n${renderNotes([note])}\n`;
}

export function renderNotes(notes: readonly BackendNote[]): string {
  const lines: string[] = [];
  for (const note of notes) {
    // `code` before `message`, always: skills branch on the code, and a code that
    // trails a paragraph of prose is a code nobody parses.
    lines.push(`[${note.level}] ${note.code}: ${note.message}`);
    if (note.remedy !== undefined && note.remedy !== "") lines.push(`  remedy: ${note.remedy}`);
  }
  return lines.join("\n");
}

export function renderHealth(h: FacadeHealth): string {
  const lines: string[] = [];
  lines.push(`engine: ${h.engineId ?? "(none configured — tier 0 only)"}`);

  if (h.engine !== undefined) {
    if (h.engine.indexedFiles !== undefined) lines.push(`indexed files: ${h.engine.indexedFiles}`);
    lines.push("capabilities:");
    for (const [capability, status] of Object.entries(h.engine.capabilities)) {
      if (status.ready) {
        lines.push(`  ${capability}: ready`);
        continue;
      }
      const permanence = status.retryable ? "retryable" : "permanent";
      const remedy = status.remedy === undefined ? "" : `  remedy: ${status.remedy}`;
      lines.push(`  ${capability}: unready (${permanence}) — ${status.reason}${remedy}`);
    }
    // `detail` is opaque and engine-specific by contract. Iterated, never branched on,
    // and named in no other core module.
    const detail = h.engine.detail;
    if (detail !== undefined) {
      const entries = Object.entries(detail);
      if (entries.length > 0) {
        lines.push(`engine detail: ${entries.map(([k, v]) => `${k}=${scalar(v)}`).join(", ")}`);
      }
    }
  }

  lines.push("settings layers (lowest precedence first):");
  for (const layer of h.settingsLayers) lines.push(`  ${layer.status}: ${layer.path}`);

  if (h.ripgrep !== undefined) {
    const via = h.ripgrep.systemPath === undefined ? "" : ` (${h.ripgrep.systemPath})`;
    lines.push(`ripgrep: ${h.ripgrep.working ? "working" : "not working"}, mode ${h.ripgrep.mode}${via}`);
  }
  if (h.shim !== undefined) {
    const s = h.shim;
    lines.push(
      `rg shim: ${s.present ? `present, owner ${s.owner}${s.version === undefined ? "" : ` v${s.version}`}` : "absent"} at ${s.path}`,
    );
    if (s.shadowedBy !== undefined) lines.push(`  shadowed on PATH by: ${s.shadowedBy}`);
    if (s.functionShadowed) lines.push("  shadowed in Bash by a shell function");
    if (s.restartRequired) lines.push("  restart required for the repair to take effect");
  }

  const notes = renderNotes(h.notes);
  if (notes !== "") {
    lines.push("");
    lines.push(notes);
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function servedByLine(served: ServedBy): string {
  let line = `served_by: ${served.engine}/${served.capability}`;
  if (served.substituted !== undefined) {
    line += `  substituted for ${served.substituted.requested}: ${served.substituted.reason}`;
  }
  if (served.defaulted !== undefined && served.defaulted.length > 0) {
    line += `  defaults: ${served.defaulted.join(", ")}`;
  }
  return line;
}

function renderHit(hit: Hit, position: number, opts: RenderOptions): string[] {
  const lines: string[] = [renderHitHeader(hit, position)];
  const key = locationKey(hit);

  if (opts.ledger.seen(key)) {
    lines.push(`${TEXT_INDENT}${REPEAT_POINTER}`);
    return lines;
  }
  opts.ledger.mark(key);

  if (opts.showEvidence) {
    // Generic iteration only. Naming a key here would be the port leaking the adapter
    // — the whole reason `evidence` is typed `unknown`.
    const entries = Object.entries(hit.evidence ?? {});
    if (entries.length > 0) {
      lines.push(`${TEXT_INDENT}evidence: ${entries.map(([k, v]) => `${k}=${scalar(v)}`).join(", ")}`);
    }
  }

  if (hit.text !== undefined && hit.text !== "") {
    const textLines = hit.text.replace(/\n+$/u, "").split("\n");
    const shown = textLines.slice(0, Math.max(opts.maxTextLines, 1));
    for (const line of shown) lines.push(`${TEXT_INDENT}${line}`);
    const rest = textLines.length - shown.length;
    if (rest > 0) lines.push(`${TEXT_INDENT}… +${rest} more lines (Read the file)`);
  }
  return lines;
}

function renderHitHeader(hit: Hit, position: number): string {
  const span = hit.endLine !== undefined && hit.endLine !== hit.line ? `-${hit.endLine}` : "";
  let head = `${position}. ${hit.file}:${hit.line}${span}`;
  if (hit.symbol !== undefined) {
    head += `  ${hit.symbol.name}`;
    // `exported` is rendered only when the engine PROVED it. undefined is not false.
    head += `  [${hit.symbol.kind}${hit.symbol.exported === true ? ", exported" : ""}]`;
  }
  if (hit.relevance !== undefined) head += `  rel=${hit.relevance}`;
  if (hit.centrality !== undefined) head += `  centrality=${hit.centrality.toFixed(3)}`;
  return head;
}

/**
 * Two truncation sentences, never interchangeable. The engine-reported total is the
 * discriminator: without one, the only honest claim is that WE cut the list. mnemex
 * `callees` can only ever produce the second, because it has no limit parameter to
 * compare a result count against.
 */
function truncationLine(o: Outcome<Hit>): string | undefined {
  if (!o.truncated) return undefined;
  const shown = o.results.length;
  if (o.total !== undefined) {
    return `truncated: yes — ${shown} shown of ${o.total}, the engine stopped early.`;
  }
  return `truncated: yes — ${shown} shown, cut by this facade; the engine reported no total.`;
}

function staleFiles(notes: readonly BackendNote[]): string[] {
  const files: string[] = [];
  for (const note of notes) {
    if (note.code !== "index_stale" || note.files === undefined) continue;
    for (const file of note.files) if (!files.includes(file)) files.push(file);
  }
  return files;
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? String(value);
}
