// Pure core of ticket-ref.ts: ticket references, label colours and window
// names. No IO: nothing here reads the clock, the environment, the filesystem
// or the process table.

/** Which tracker a reference belongs to. `key` is an `ABC-123` key whose tracker the reference alone cannot name. */
export type Tracker = "github" | "linear" | "key";

export interface TicketRef {
  tracker: Tracker;
  /** The reference as the tracker writes it: `#7`, `owner/repo#7`, `ABC-7`. */
  id: string;
  /** Lower-case prefix of the window name: `gh-7`, `<repo>-7`, `abc-7`. */
  slug: string;
  /** `owner/repo` for a GitHub issue (`this repo` for `#N`, possibly null); null otherwise. */
  repo: string | null;
  /** The GitHub issue number; null otherwise. */
  number: number | null;
}

export type LabelColour = "red" | "green" | "blue";

/** Owner and repository names as GitHub allows them. */
const REPO_PART = "[A-Za-z0-9_.-]+";
const NUM = "[0-9]+";
const KEY = "[A-Za-z][A-Za-z0-9]*-[0-9]+";

const HASH_RE = new RegExp(`^#(${NUM})$`);
const OWNER_REPO_RE = new RegExp(`^(${REPO_PART})/(${REPO_PART})#(${NUM})$`);
const GITHUB_URL_RE = new RegExp(`^https?://(?:www\\.)?github\\.com/(${REPO_PART})/(${REPO_PART})/issues/(${NUM})/?(?:[?#].*)?$`, "i");
const LINEAR_URL_RE = new RegExp(`^https://linear\\.app/[^/?#]+/issue/(${KEY})(?:[/?#].*)?$`, "i");
const KEY_RE = new RegExp(`^(${KEY})$`);

/** Parses a decimal issue number; null for 0. */
function issueNumber(digits: string): number | null {
  const n = Number.parseInt(digits, 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function githubRef(owner: string, repo: string, digits: string, thisRepo: string | null): TicketRef | null {
  const n = issueNumber(digits);
  if (n === null) return null;
  const full = `${owner}/${repo}`;
  const isThisRepo = thisRepo !== null && thisRepo.toLowerCase() === full.toLowerCase();
  const prefix = isThisRepo ? "gh" : repo.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return { tracker: "github", id: `${full}#${n}`, slug: `${prefix}-${n}`, repo: full, number: n };
}

/** Normalises a key's number (`ABC-007` → `ABC-7`); null when it is 0. */
function normaliseKey(key: string): { id: string; slug: string } | null {
  const dash = key.lastIndexOf("-");
  const n = issueNumber(key.slice(dash + 1));
  if (n === null) return null;
  const id = `${key.slice(0, dash).toUpperCase()}-${n}`;
  return { id, slug: id.toLowerCase() };
}

/**
 * Parses a ticket reference. `ref` is trimmed; `thisRepo` is the current
 * repository as `owner/repo` (compared case-insensitively), or null.
 *
 * - `#N` → GitHub in this repo, slug `gh-N`.
 * - `owner/repo#N` and `https://github.com/owner/repo/issues/N` (http, `www.`,
 *   a trailing `/`, `?…` or `#…` allowed) → GitHub, slug `gh-N` in this repo,
 *   else the repo name lower-cased with characters outside a-z 0-9 . _ -
 *   removed, then `-N`. A pull request URL is not a ticket.
 * - `https://linear.app/<workspace>/issue/KEY-N[/…]` → Linear; https only,
 *   no `www.`.
 * - a bare `KEY-N` → `key`: the tracker is decided elsewhere.
 *
 * Every `N` is written back without leading zeros; `N` = 0 is rejected.
 * Returns null for anything else. Never throws.
 */
export function parseTicketRef(ref: string, thisRepo: string | null): TicketRef | null {
  const text = ref.trim();
  let m = HASH_RE.exec(text);
  if (m) {
    const n = issueNumber(m[1] ?? "");
    return n === null ? null : { tracker: "github", id: `#${n}`, slug: `gh-${n}`, repo: thisRepo, number: n };
  }
  m = OWNER_REPO_RE.exec(text) ?? GITHUB_URL_RE.exec(text);
  if (m) return githubRef(m[1] ?? "", m[2] ?? "", m[3] ?? "", thisRepo);
  m = LINEAR_URL_RE.exec(text);
  if (m) {
    const key = normaliseKey(m[1] ?? "");
    return key === null ? null : { tracker: "linear", ...key, repo: null, number: null };
  }
  m = KEY_RE.exec(text);
  if (m) {
    const key = normaliseKey(m[1] ?? "");
    return key === null ? null : { tracker: "key", ...key, repo: null, number: null };
  }
  return null;
}

/** A ticket as a record or a launch claim stores it. */
export type StoredTicket = { id: string; url: string | null };

/**
 * True when reference `given` names the ticket stored as `stored`. A `#N` or
 * bare `N` in `given` is read in `stored`'s repo. Two GitHub references match
 * on the number and, when both name one, the repo (case-insensitively); other
 * references match on the normalised key. A reference that does not parse
 * matches only the same text.
 */
function namesTicket(given: string, stored: string): boolean {
  const home = parseTicketRef(stored, null)?.repo ?? null;
  const a = parseTicketRef(/^[0-9]+$/.test(given.trim()) ? `#${given.trim()}` : given, home);
  const b = parseTicketRef(stored, home);
  if (a === null || b === null) return given.trim().toLowerCase() === stored.trim().toLowerCase();
  if (a.tracker === "github" || b.tracker === "github") {
    if (a.tracker !== b.tracker || a.number !== b.number) return false;
    return a.repo === null || b.repo === null || a.repo.toLowerCase() === b.repo.toLowerCase();
  }
  return a.id === b.id;
}

export type ChildTicket = { ok: true; ticket: StoredTicket } | { ok: false; error: string };

/**
 * The ticket of a child launched by a manager: the manager's own ticket, id
 * and URL as its record stores them, whatever checkout the child runs in. A
 * `--ticket` given with the launch must name that ticket (`namesTicket`), or
 * the launch is refused; it never replaces it. Never throws.
 */
export function childTicket(given: string | null, manager: StoredTicket): ChildTicket {
  if (given !== null && !namesTicket(given, manager.id)) {
    return { ok: false, error: `--ticket ${given} is not ${manager.id}, the ticket of the manager starting this child; a child works under its manager's ticket` };
  }
  return { ok: true, ticket: { id: manager.id, url: manager.url } };
}

const COLOUR_KEYWORDS:ReadonlyArray<readonly [LabelColour, readonly string[]]> = [
  ["red", ["bug", "bugfix", "fix", "defect"]],
  ["green", ["feature", "enhancement", "feat"]],
  ["blue", ["improvement", "chore", "refactor", "perf"]],
];

/**
 * Picks the ticket colour from its labels. Each label is lower-cased and split
 * into words on runs of characters outside a-z 0-9; a word matches keyword `k`
 * when it is `k`, `k + "s"` or `k + "es"`. Red (bug, bugfix, fix, defect) beats
 * green (feature, enhancement, feat), which beats blue (improvement, chore,
 * refactor, perf). Null when no word matches. Never throws.
 */
export function colourForLabels(labels: readonly string[]): LabelColour | null {
  const words = new Set(labels.flatMap((label) => label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "")));
  for (const [colour, keywords] of COLOUR_KEYWORDS) {
    if (keywords.some((k) => words.has(k) || words.has(`${k}s`) || words.has(`${k}es`))) return colour;
  }
  return null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;
/** Longest window and worktree name the launcher accepts. */
const MAX_NAME = 48;

/**
 * Builds a window and worktree name: `slug` and 2 to 4 title words joined by
 * `-`. Each word is lower-cased and stripped of characters outside a-z 0-9;
 * empty words are dropped. While the name is longer than 48 characters the
 * last word is dropped; at least one word remains.
 *
 * Throws an Error when `slug` does not match `^[a-z0-9][a-z0-9._-]*$`, when
 * fewer than 2 or more than 4 words remain after stripping, or when `slug`
 * plus one word is longer than 48 characters.
 */
export function buildTicketName(slug: string, words: readonly string[]): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid ticket slug ${JSON.stringify(slug)}`);
  const kept = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((w) => w !== "");
  if (kept.length < 2 || kept.length > 4) {
    throw new Error(`a name needs 2 to 4 title words of letters or digits; got ${kept.length}`);
  }
  const first = kept[0] ?? "";
  if (slug.length + 1 + first.length > MAX_NAME) {
    throw new Error(`${slug}-${first} is longer than ${MAX_NAME} characters`);
  }
  let name = [slug, ...kept].join("-");
  while (name.length > MAX_NAME && kept.length > 1) {
    kept.pop();
    name = [slug, ...kept].join("-");
  }
  return name;
}

const REMOTE_PATTERNS = [
  new RegExp(`^git@github\\.com:(${REPO_PART})/(${REPO_PART})$`, "i"),
  new RegExp(`^ssh://git@github\\.com/(${REPO_PART})/(${REPO_PART})$`, "i"),
  new RegExp(`^https://github\\.com/(${REPO_PART})/(${REPO_PART})/?$`, "i"),
];

/**
 * Reads `owner/repo` from a GitHub remote URL: `git@github.com:owner/repo`,
 * `ssh://git@github.com/owner/repo` or `https://github.com/owner/repo` (a
 * trailing `/` allowed on https), each with or without `.git`, after trimming.
 * Null for any other host or shape. Never throws.
 */
export function repoFromRemoteUrl(url: string): string | null {
  const text = url.trim();
  for (const re of REMOTE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const owner = m[1] ?? "";
    const repo = (m[2] ?? "").replace(/\.git$/, "");
    return repo === "" ? null : `${owner}/${repo}`;
  }
  return null;
}
