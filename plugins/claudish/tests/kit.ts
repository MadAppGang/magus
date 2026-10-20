// The kit's `test`, with a 60 s default time limit in place of the kit's 5 s.
//
// Why: `claude plugin test` runs every file at once, each in its own child, and many of these tests
// drive minutes of fake clock through the whole mod. On a busy machine (load 30–90 measured on an
// 18-core Mac, 2026-10-21) tests that take 1–3 s took over 5 s and failed with nothing wrong; alone,
// the same files passed every time. The kit has no suite-wide setting, so every test file imports
// `test` from here. The 60 s is a floor: every `timeoutMs` a test sets was set to give it more than
// the kit's 5 s (20 s for `ext team` still failed at load 91), so a test may ask for longer, never
// for less. A real hang still fails, at 60 s.

import { test as kitTest, type TestBody, type TestOptions } from 'claude-code/testing'

const MIN_TIMEOUT_MS = 60_000

export function test(name: string, ...rest: readonly [body: TestBody] | readonly [options: TestOptions, body: TestBody]): void {
  if (rest.length === 1) return kitTest(name, { timeoutMs: MIN_TIMEOUT_MS }, rest[0])
  const [options, body] = rest
  return kitTest(name, { ...options, timeoutMs: Math.max(MIN_TIMEOUT_MS, options.timeoutMs ?? 0) }, body)
}
