/**
 * pattern.ts — which Grep patterns may merge, and how a line is matched against one.
 *
 * Merging is restricted to strictly literal, word-like ASCII patterns. Every character
 * the routing regex accepts is a literal to ripgrep, so rg and the engine read the
 * pattern the same way, and a plain substring test reproduces rg's match set. Widening
 * the charset (Unicode identifiers, `.`, any regex metacharacter) would need a real regex
 * matcher and would reopen the case-folding differences between JS and rg.
 *
 * `WORDLIKE_SOURCE` is the shim's `CSRG_WORDLIKE` byte for byte. It is ASCII, so byte
 * equality and string equality are the same claim. The character classes are spelled
 * out letter by letter because a range such as `[a-z]` is locale-dependent in bash, and
 * the shim must route exactly as this module decides.
 */

export const WORDLIKE_SOURCE =
  "^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_][ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_]*((::| |-)[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_]+){0,3}$";

const WORDLIKE = new RegExp(WORDLIKE_SOURCE);

/** Bounds on the pattern's length. The class above is ASCII-only, so characters and
 *  bytes coincide for every pattern that can pass, and the shim's `${#…}` agrees. */
const MIN_LENGTH = 3;
const MAX_LENGTH = 100;

export function isWordLike(p: string): boolean {
  return p.length >= MIN_LENGTH && p.length <= MAX_LENGTH && WORDLIKE.test(p);
}

/** Only the characters that are syntax outside a class. Under the `u` flag an escape of
 *  any other character (`\-`, `\:`) is itself a SyntaxError, so escaping "everything
 *  non-word" would throw on exactly the separators word-like patterns contain. */
function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/gu, "\\$&");
}

/**
 * A substring test, never a word-boundary test: rg matches `parseConfig` inside
 * `parseConfigFile`, and so must this. The word-like regex above only routes.
 *
 * With `ignoreCase` the `u` flag supplies simple case folding. For an ASCII pattern that
 * adds exactly U+212A KELVIN SIGN ↔ `k` and U+017F LONG S ↔ `s`, which is what rg `-i`
 * folds as well.
 */
export function makeLineMatcher(pattern: string, ignoreCase: boolean): (line: string) => boolean {
  if (!ignoreCase) return (line) => line.includes(pattern);
  const re = new RegExp(escapeRegExp(pattern), "iu");
  return (line) => re.test(line);
}
