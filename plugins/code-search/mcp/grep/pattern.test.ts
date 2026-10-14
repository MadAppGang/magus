import { describe, expect, test } from "bun:test";
import { WORDLIKE_SOURCE, isWordLike, makeLineMatcher } from "./pattern";

describe("word-like eligibility", () => {
  test.each([
    "abc", "sessionStore", "parse config", "std::vector", "kebab-case-name", "_private",
    "a".repeat(100),
  ])("accepts the literal pattern %s", (pattern) => {
    expect(isWordLike(pattern)).toBe(true);
    expect(new RegExp(WORDLIKE_SOURCE).test(pattern)).toBe(true);
  });

  test.each([
    "ab", "a".repeat(101), "a.b", "a  b", "abc-", "Straße", "1abc", "a-b-c-d-e",
    "foo|bar", String.raw`foo\b`, "foo_bar?", " leading", "trailing ",
  ])("rejects the non-literal or out-of-bounds pattern %s", (pattern) => {
    expect(isWordLike(pattern)).toBe(false);
  });
});

describe("line matcher", () => {
  test("case-sensitive matching is literal", () => {
    const match = makeLineMatcher("a.b", false);
    expect(match("prefix a.b suffix")).toBe(true);
    expect(match("prefix axb suffix")).toBe(false);
    expect(match("prefix A.B suffix")).toBe(false);
  });

  test("ignore-case matching escapes metacharacters and uses Unicode case folding", () => {
    const match = makeLineMatcher("A.B", true);
    expect(match("prefix a.b suffix")).toBe(true);
    expect(match("prefix axb suffix")).toBe(false);
  });
});
