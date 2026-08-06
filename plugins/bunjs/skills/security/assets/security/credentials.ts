/**
 * Password and token handling.
 *
 * Bun ships the primitives natively — `Bun.password` (argon2id + bcrypt) and
 * `node:crypto.timingSafeEqual`. The value added here is the surrounding policy,
 * which is where the real bugs live: comparing tokens with `===`, hashing a token
 * with the same cost as a password, and leaking user existence through response
 * timing.
 */
import { timingSafeEqual, randomBytes, createHash } from "node:crypto";

/**
 * Hash a user password.
 *
 * MEASURED (Bun 1.3.10): the default is argon2id at `m=65536,t=2,p=1`, producing a
 * 118-char string and taking **~96 ms**. That cost is the entire point — it is what
 * makes offline brute force expensive — so do NOT tune it down to make a login
 * endpoint feel snappy. Tune your login rate limit instead.
 *
 * `Bun.password.verify` auto-detects the algorithm from the hash prefix (MEASURED:
 * a bcrypt hash verified with no options passed), so you can migrate algorithms
 * without a flag day: keep verifying old hashes, re-hash on successful login.
 */
export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain); // argon2id defaults — deliberately not overridden
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}

/**
 * Does this stored hash use outdated parameters?
 *
 * Call after a successful verify; if true, re-hash the plaintext you already have and
 * store it. This is the only moment you legitimately hold the password, so it is the
 * only place migration can happen.
 */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith("$argon2id$v=19$m=65536,t=2,p=1");
}

/**
 * A cryptographically random token, base64url so it is URL- and cookie-safe with no
 * escaping.
 *
 * 32 bytes = 256 bits. `Math.random()` is NOT acceptable here: it is seeded PRNG state,
 * predictable from prior outputs, and has produced real session-prediction vulnerabilities.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Hash a high-entropy token (session id, API key) for storage.
 *
 * SHA-256, deliberately — NOT argon2. Slow hashing defends low-entropy secrets against
 * brute force; a 256-bit random token cannot be brute-forced, so the ~96 ms argon2 cost
 * would buy nothing and turn every authenticated request into a 96 ms operation.
 *
 * Storing the hash rather than the token means a database leak does not hand over live
 * credentials.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time string comparison.
 *
 * `a === b` short-circuits at the first differing byte, so response time leaks how many
 * leading characters were correct — enough to reconstruct a token byte by byte.
 *
 * MEASURED: `timingSafeEqual` **throws** `Input buffers must have the same byte length`
 * on unequal lengths. Hashing both sides first fixes that and removes the length leak:
 * every comparison is now 32 bytes regardless of input.
 */
export function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/**
 * Verify a presented token against a stored hash, in constant time.
 * `stored` is what `hashToken` produced.
 */
export function verifyToken(presented: string, storedHash: string): boolean {
  return safeEqual(hashToken(presented), storedHash);
}

/**
 * Password login with a uniform cost regardless of whether the user exists.
 *
 * The vulnerability this closes is subtle and common: `if (!user) return false` returns
 * in microseconds, while a real user costs ~96 ms of argon2. That difference is trivially
 * measurable over the network and turns a login endpoint into a user enumeration oracle —
 * which then feeds credential stuffing.
 *
 * The fix is to verify against a dummy hash when the user is absent, so both paths pay
 * the same cost.
 */
export interface LoginDeps<U> {
  findUser: (identifier: string) => Promise<U | null>;
  getHash: (user: U) => string;
  /** A real argon2 hash of an arbitrary string; generate once at boot. */
  dummyHash: string;
}

export async function authenticate<U>(
  identifier: string,
  password: string,
  deps: LoginDeps<U>,
): Promise<U | null> {
  const user = await deps.findUser(identifier);
  if (!user) {
    // Burn the same ~96 ms so timing cannot distinguish this branch.
    await Bun.password.verify(password, deps.dummyHash).catch(() => false);
    return null;
  }
  const okPassword = await Bun.password.verify(password, deps.getHash(user));
  return okPassword ? user : null;
}

/** Build the dummy hash once at boot; hashing per request would double login cost. */
export function makeDummyHash(): Promise<string> {
  return Bun.password.hash(generateToken());
}

/**
 * Redact secrets from anything headed for a log.
 *
 * Logs are the most widely-copied, longest-retained data a service produces, and the
 * classic breach is a request body logged verbatim on error. Key-based rather than
 * value-based: you cannot reliably recognise a secret by its shape.
 */
const SECRET_KEY = /^(pass(word)?|secret|token|api[_-]?key|authorization|cookie|session|credit_?card|cvv|ssn)$/i;

export function redact<T>(value: T, depth = 6): T {
  if (depth <= 0 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth - 1)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redact(v, depth - 1);
  }
  return out as T;
}
