/**
 * Response helpers.
 *
 * These exist so that every endpoint answers with the same envelope, the same headers
 * and the same status semantics. Hand-built `new Response(JSON.stringify(...))` calls
 * drift within a week: one forgets `content-type`, one returns 200 for a creation, one
 * invents `{ data: … }` while its neighbour returns the bare object.
 */

/**
 * These helpers object-spread their headers, so the parameter is a plain record —
 * `Bun.HeadersInit` also admits `string[][]` and `Headers`, neither of which spreads.
 * Narrower than the platform type, and honest about what is actually supported.
 */
export type HeaderRecord = Record<string, string>;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

/** 200 with a JSON body. */
export const ok = <T>(body: T, headers: HeaderRecord = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...JSON_HEADERS, ...headers } });

/**
 * 201 with a `Location` header.
 *
 * The header is the part everyone forgets, and it is the difference between a REST
 * client that can follow the new resource and one that has to guess the URL.
 */
export const created = <T>(body: T, location: string, headers: HeaderRecord = {}): Response =>
  new Response(JSON.stringify(body), { status: 201, headers: { ...JSON_HEADERS, location, ...headers } });

/**
 * 204: no body, and per RFC 9110 it must not carry `content-length` or `content-type`.
 * `new Response(null, …)` is required — an empty string still produces a zero-length body.
 */
export const noContent = (headers: HeaderRecord = {}): Response => new Response(null, { status: 204, headers });

/** 202 for work accepted but not yet done — pair with a status URL the client can poll. */
export const accepted = <T>(body: T, statusUrl?: string): Response =>
  new Response(JSON.stringify(body), {
    status: 202,
    headers: statusUrl ? { ...JSON_HEADERS, location: statusUrl } : JSON_HEADERS,
  });

/** 303 after a successful POST — redirects the browser to a GET, so refresh cannot resubmit. */
export const seeOther = (location: string): Response => new Response(null, { status: 303, headers: { location } });

export interface PageInfo {
  /** Opaque cursor for the next page; absent means this is the last page. */
  nextCursor?: string;
  /** Total count, only when it is cheap. An expensive COUNT(*) per page is a common footgun. */
  total?: number;
}

/**
 * Envelope for collections. A bare top-level JSON array cannot carry pagination, so
 * adding it later is a breaking change — start with the object.
 */
export const page = <T>(items: readonly T[], info: PageInfo = {}): Response =>
  new Response(JSON.stringify({ items, ...info }), { status: 200, headers: JSON_HEADERS });

/**
 * Conditional GET. Returns a 304 when the client's `If-None-Match` matches, otherwise
 * the body with an `ETag`.
 *
 * This is the cheapest latency and bandwidth win available on a read endpoint: the
 * response never leaves the server. A 304 must not carry a body.
 */
export function withETag<T>(req: Request, body: T, headers: HeaderRecord = {}): Response {
  const serialized = JSON.stringify(body);
  // Non-cryptographic hash: this is a cache key, not a security boundary, and
  // MEASURED ~10x faster than sha256 over the same bytes.
  const etag = `"${Bun.hash(serialized).toString(36)}"`;

  const inm = req.headers.get("if-none-match");
  if (inm && etagMatches(inm, etag)) {
    return new Response(null, { status: 304, headers: { etag, ...headers } });
  }
  return new Response(serialized, { status: 200, headers: { ...JSON_HEADERS, etag, ...headers } });
}

/**
 * `If-None-Match` may be a comma-separated list, `*`, or carry a `W/` weak prefix.
 * Naive `inm === etag` silently disables caching for any client that sends a list.
 */
function etagMatches(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === "*") return true;
  const normalize = (v: string) => v.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((candidate) => normalize(candidate) === normalize(etag));
}

/**
 * Stream a JSON array without buffering it.
 *
 * The reason to bother: `JSON.stringify` of a large collection is a single synchronous
 * block. MEASURED, `JSON.parse` of a 1.81 MiB payload took 76 ms — stringify is the same
 * order — and during it the event loop serves nobody. Streaming keeps peak memory flat
 * and lets the client start parsing immediately.
 *
 * The trade-off is real: once the first byte is sent the status is committed, so a
 * mid-stream failure cannot become a 500. Only stream what you can produce reliably.
 */
export function streamJsonArray<T>(source: AsyncIterable<T>, headers: HeaderRecord = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode("["));
      let first = true;
      try {
        for await (const item of source) {
          controller.enqueue(encoder.encode((first ? "" : ",") + JSON.stringify(item)));
          first = false;
        }
        controller.enqueue(encoder.encode("]"));
        controller.close();
      } catch (err) {
        // The array is left unterminated on purpose: a truncated payload fails the
        // client's JSON parse, which is the only honest signal available once a 200
        // has been sent. Silently closing with "]" would hand over a short list that
        // looks complete.
        controller.error(err);
      }
    },
  });
  return new Response(stream, { status: 200, headers: { ...JSON_HEADERS, ...headers } });
}
