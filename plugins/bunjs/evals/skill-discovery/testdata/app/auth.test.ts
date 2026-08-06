/**
 * RED STATE: `src/auth.ts` does not exist, so `bun test` fails until the agent
 * writes it. A no-op run cannot pass this bench.
 *
 * These assertions deliberately test BEHAVIOUR ONLY — signup, login, wrong
 * password, unknown user. They say nothing about which hash, whether user
 * existence is timing-safe, or how the rate limiter is keyed.
 *
 * That silence is the point: the bench measures whether the SKILL influenced
 * those choices. A test that named argon2id would hand the agent the answer and
 * make the fingerprint checks meaningless.
 */
import { test, expect } from "bun:test";
import { signup, login } from "./src/auth";

test("a new user can sign up and then log in", async () => {
  await signup("alice@example.test", "correct horse battery staple");
  const session = await login("alice@example.test", "correct horse battery staple");
  expect(session).toBeTruthy();
});

test("the wrong password is rejected", async () => {
  await signup("bob@example.test", "hunter2");
  const session = await login("bob@example.test", "wrong-password");
  expect(session).toBeFalsy();
});

test("an unknown user is rejected", async () => {
  const session = await login("nobody@example.test", "anything");
  expect(session).toBeFalsy();
});

test("the stored credential is not the plaintext password", async () => {
  const { storedCredentialFor } = await import("./src/auth");
  await signup("carol@example.test", "s3cret-value");
  const stored = await storedCredentialFor("carol@example.test");
  expect(stored).toBeTruthy();
  expect(stored).not.toContain("s3cret-value");
});
