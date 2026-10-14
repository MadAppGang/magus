/**
 * call.ts — one search call, whichever route it arrived by.
 *
 * Both routes reduce to this shape before the service sees them: a Bash `grep` argv
 * (`bash-grep.ts`) and a Grep-tool input (`grep-tool.ts`). The service never looks at the
 * route's own syntax again, so everything route-specific lives in the two parsers and in
 * `walkArgs`, the oracle flags that make `rg --files` list what that route's search read.
 */

/** The VCS directories both routes exclude: the snapshot's ugrep passes `--exclude-dir`
 *  for each, and the Grep tool passes `--glob !<d>` for each. */
export const VCS_DIRS = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"] as const;

export interface SearchCall {
  route: "bash" | "tool";
  mode: "content" | "files";
  pattern: string;
  ignoreCase: boolean;
  /** Context the call printed around each match. Used only for printed(F): an extra
   *  inside it would repeat a line grep already showed. */
  before: number;
  after: number;
  /** Path operands as written; `[]` means the request's cwd. */
  roots: readonly string[];
  /** The oracle's flags for this route (D7), in exact order. */
  walkArgs: readonly string[];
}

/** Why a call is not merged. The service turns `"offset"` into its own reason and every
 *  other decline into `argv`. */
export type Decline = { decline: string };

export function isDecline(value: SearchCall | Decline): value is Decline {
  return "decline" in value;
}
