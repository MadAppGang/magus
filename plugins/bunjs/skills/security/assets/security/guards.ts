/**
 * Request-level guards: rate limiting, security headers, CORS.
 *
 * These are the controls that are trivially wrong in ways that look right — a rate
 * limiter keyed on a spoofable header, a CORS policy that reflects any origin, a
 * `Content-Security-Policy` with `unsafe-inline` that disables the protection it names.
 */

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — the value for `Retry-After`. */
  retryAfterSeconds: number;
  limit: number;
}

/**
 * Fixed-window rate limiter.
 *
 * In-process and therefore **per-instance**: with N replicas the effective limit is
 * N × limit. That is fine for coarse abuse protection and NOT fine as a billing or
 * security control — for those you need a shared store (Redis) so the count is global.
 * Stated here because the failure is silent: it works perfectly in staging on one
 * instance and is 10x looser in production.
 *
 * Fixed windows allow a burst of up to 2x limit across a boundary (all of window N's
 * budget at its end, all of N+1's at its start). A sliding-window or token-bucket
 * variant fixes that; for abuse protection the burst rarely matters.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitResult {
    const now = this.now();
    const entry = this.hits.get(key);

    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return { allowed: true, remaining: this.options.limit - 1, retryAfterSeconds: 0, limit: this.options.limit };
    }

    entry.count++;
    const allowed = entry.count <= this.options.limit;
    return {
      allowed,
      remaining: Math.max(0, this.options.limit - entry.count),
      retryAfterSeconds: allowed ? 0 : Math.ceil((entry.resetAt - now) / 1000),
      limit: this.options.limit,
    };
  }

  /**
   * Drop expired entries. Without this the Map grows once per distinct key forever —
   * an unbounded memory leak that an attacker can drive by varying the key. Call it on
   * an interval, and `unref()` that interval so it cannot hold the process open.
   */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.hits) {
      if (now >= entry.resetAt) {
        this.hits.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.hits.size;
  }

  reset(): void {
    this.hits.clear();
  }
}

/** Standard rate-limit headers, so clients can back off instead of hammering. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "ratelimit-limit": String(result.limit),
    "ratelimit-remaining": String(result.remaining),
  };
  if (!result.allowed) headers["retry-after"] = String(result.retryAfterSeconds);
  return headers;
}

/**
 * Derive a rate-limit key from the request.
 *
 * `x-forwarded-for` is **client-controlled** unless a proxy you own overwrites it. Reading
 * it unconditionally lets an attacker send a different forged IP per request and bypass
 * the limiter entirely. `trustProxyHops` says how many trailing entries your own
 * infrastructure appended; anything to the left of those is attacker-supplied.
 */
export function clientKey(
  req: Request,
  directIp: string | undefined,
  trustProxyHops = 0,
): string {
  if (trustProxyHops <= 0) return directIp ?? "unknown";

  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // The right-most entries were appended by infrastructure we control. Step left by the
  // number of hops we trust; anything further left is forgeable.
  const index = chain.length - trustProxyHops;
  return chain[index] ?? directIp ?? "unknown";
}

export interface SecurityHeaderOptions {
  /** Omit CSP for pure JSON APIs where it does nothing; set it for anything HTML. */
  contentSecurityPolicy?: string;
  /** Seconds. Only meaningful over HTTPS. */
  hstsMaxAge?: number;
  includeSubDomains?: boolean;
}

/**
 * Security response headers.
 *
 * Defaults are the strict ones. `default-src 'none'` is correct for a JSON API — it
 * serves no scripts, styles or frames, so nothing should ever load. Loosening it for an
 * HTML app is a deliberate act.
 *
 * `unsafe-inline` in a script-src disables the XSS protection CSP exists to provide;
 * if you need inline scripts, use a nonce or hash instead.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const { contentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'", hstsMaxAge = 31_536_000, includeSubDomains = true } = options;

  return {
    // Stop browsers guessing a content type — a JSON response sniffed as HTML is XSS.
    "x-content-type-options": "nosniff",
    // Legacy clickjacking defence; frame-ancestors in CSP is the modern one. Both is fine.
    "x-frame-options": "DENY",
    // Do not leak the full URL (which may hold ids or tokens) to other origins.
    "referrer-policy": "no-referrer",
    "content-security-policy": contentSecurityPolicy,
    "strict-transport-security": `max-age=${hstsMaxAge}${includeSubDomains ? "; includeSubDomains" : ""}`,
    // Deny powerful browser features by default.
    "permissions-policy": "geolocation=(), camera=(), microphone=(), payment=()",
    // Do not advertise the stack.
    "x-permitted-cross-domain-policies": "none",
  };
}

export interface CorsOptions {
  /** Exact origins. There is deliberately no wildcard option. */
  allowedOrigins: readonly string[];
  allowedMethods?: readonly string[];
  allowedHeaders?: readonly string[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
}

/**
 * CORS headers for a request, or `null` when the origin is not allowed.
 *
 * Two rules encoded here that are routinely broken:
 *
 * 1. **Never reflect an arbitrary `Origin`.** Echoing whatever the client sent is
 *    functionally identical to `*` while looking deliberate — any site can then read
 *    authenticated responses.
 * 2. **`*` with credentials is rejected by browsers.** Combining them yields a policy
 *    that silently fails in the browser, so people "fix" it by reflecting the origin,
 *    arriving straight back at rule 1.
 *
 * `Vary: Origin` is mandatory whenever the response depends on the origin, or a shared
 * cache will serve one origin's CORS headers to another.
 */
export function corsHeaders(req: Request, options: CorsOptions): Record<string, string> | null {
  const origin = req.headers.get("origin");
  if (!origin) return {}; // same-origin or non-browser: no CORS headers needed
  if (!options.allowedOrigins.includes(origin)) return null;

  const {
    allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders = ["content-type", "authorization"],
    allowCredentials = false,
    maxAgeSeconds = 600,
  } = options;

  const headers: Record<string, string> = {
    "access-control-allow-origin": origin, // safe: membership was checked above
    "access-control-allow-methods": allowedMethods.join(", "),
    "access-control-allow-headers": allowedHeaders.join(", "),
    "access-control-max-age": String(maxAgeSeconds),
    vary: "Origin",
  };
  if (allowCredentials) headers["access-control-allow-credentials"] = "true";
  return headers;
}
