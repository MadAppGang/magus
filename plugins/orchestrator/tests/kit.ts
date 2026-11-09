import { test as kitTest, type TestBody, type TestOptions } from "claude-code/testing";

// Parallel mod-kit children may need more wall time while driving fake timers.
export function test(name: string, ...rest: readonly [TestBody] | readonly [TestOptions, TestBody]): void {
  if (rest.length === 1) return kitTest(name, { timeoutMs: 60_000 }, rest[0]);
  return kitTest(name, { ...rest[0], timeoutMs: Math.max(60_000, rest[0].timeoutMs ?? 0) }, rest[1]);
}
