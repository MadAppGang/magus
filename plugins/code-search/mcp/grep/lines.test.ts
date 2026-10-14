import { expect, test } from "bun:test";
import { splitLines } from "./lines";

test.each([
  ["", []],
  ["a", ["a"]],
  ["a\n", ["a\n"]],
  ["a\nb", ["a\n", "b"]],
  ["a\r\nb\r\n", ["a\r\n", "b\r\n"]],
  ["\n", ["\n"]],
  ["a\n\n", ["a\n", "\n"]],
] as const)("splitLines preserves terminators for %j", (input, expected) => {
  expect(splitLines(input)).toEqual([...expected]);
});
