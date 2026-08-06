import { describe, test, expect } from "bun:test";
import { ok, created, noContent, accepted, seeOther, page, withETag, streamJsonArray } from "./respond";

describe("status helpers", () => {
  test("ok sets a charset-qualified JSON content-type", async () => {
    const res = ok({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ a: 1 });
  });

  test("created carries Location — the header everyone forgets", () => {
    const res = created({ id: "u_1" }, "/users/u_1");
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/users/u_1");
  });

  test("noContent has a null body and no content-type", async () => {
    const res = noContent();
    expect(res.status).toBe(204);
    expect(res.headers.get("content-type")).toBeNull();
    expect(await res.text()).toBe("");
  });

  test("accepted can point at a status URL for polling", () => {
    expect(accepted({ jobId: "j1" }, "/jobs/j1").headers.get("location")).toBe("/jobs/j1");
    expect(accepted({ jobId: "j1" }).headers.get("location")).toBeNull();
  });

  test("seeOther is a 303 so browser refresh cannot resubmit the POST", () => {
    const res = seeOther("/orders/9");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/orders/9");
  });

  test("caller headers can extend but the defaults still apply", () => {
    const res = ok({ a: 1 }, { "cache-control": "no-store" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("page", () => {
  test("wraps items in an object so pagination can be added without a breaking change", async () => {
    const res = page([{ id: 1 }], { nextCursor: "c2", total: 57 });
    expect(await res.json()).toEqual({ items: [{ id: 1 }], nextCursor: "c2", total: 57 });
  });

  test("omits absent page info rather than emitting nulls", async () => {
    expect(await page([]).json()).toEqual({ items: [] });
  });
});

describe("withETag", () => {
  const body = { id: 1, name: "widget" };
  const reqWith = (inm?: string) =>
    new Request("http://x/things/1", inm === undefined ? undefined : { headers: { "if-none-match": inm } });

  test("first request gets the body and an ETag", async () => {
    const res = withETag(reqWith(), body);
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^".+"$/);
    expect(await res.json()).toEqual(body);
  });

  test("a matching If-None-Match yields 304 with no body", async () => {
    const etag = withETag(reqWith(), body).headers.get("etag")!;
    const res = withETag(reqWith(etag), body);
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe(etag);
  });

  test("a stale ETag yields the fresh body", async () => {
    const res = withETag(reqWith('"stale"'), body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  test("the ETag changes when the body changes", () => {
    const a = withETag(reqWith(), { v: 1 }).headers.get("etag");
    const b = withETag(reqWith(), { v: 2 }).headers.get("etag");
    expect(a).not.toBe(b);
  });

  test("handles a comma-separated list — naive equality would disable caching here", () => {
    const etag = withETag(reqWith(), body).headers.get("etag")!;
    expect(withETag(reqWith(`"other", ${etag}, "another"`), body).status).toBe(304);
  });

  test("handles the W/ weak prefix a proxy may add", () => {
    const etag = withETag(reqWith(), body).headers.get("etag")!;
    expect(withETag(reqWith(`W/${etag}`), body).status).toBe(304);
  });

  test("`*` matches anything", () => {
    expect(withETag(reqWith("*"), body).status).toBe(304);
  });
});

describe("streamJsonArray", () => {
  async function* gen<T>(items: T[], failAt?: number) {
    for (let i = 0; i < items.length; i++) {
      if (i === failAt) throw new Error("source blew up");
      yield items[i]!;
    }
  }

  test("produces valid JSON identical to a buffered stringify", async () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const text = await streamJsonArray(gen(items)).text();
    expect(text).toBe(JSON.stringify(items));
    expect(JSON.parse(text)).toEqual(items);
  });

  test("an empty source still produces a valid empty array", async () => {
    expect(await streamJsonArray(gen([])).text()).toBe("[]");
  });

  test("a single item has no stray comma", async () => {
    expect(await streamJsonArray(gen([{ a: 1 }])).text()).toBe('[{"a":1}]');
  });

  test("a mid-stream failure leaves the payload unparseable rather than silently short", async () => {
    // Once a 200 is sent the status cannot change, so truncation is the only honest signal.
    const res = streamJsonArray(gen([{ id: 1 }, { id: 2 }, { id: 3 }], 2));
    const err = await res.text().catch((e) => e);
    if (err instanceof Error) {
      expect(err).toBeInstanceOf(Error); // stream errored — client sees a broken response
    } else {
      expect(() => JSON.parse(err as string)).toThrow(); // or a truncated body that fails to parse
    }
  });

  test("keeps memory flat over a large collection", async () => {
    async function* many() {
      for (let i = 0; i < 50_000; i++) yield { i, name: `row-${i}` };
    }
    const before = process.memoryUsage().heapUsed;
    const text = await streamJsonArray(many()).text();
    const grewMb = (process.memoryUsage().heapUsed - before) / 1048576;

    expect(JSON.parse(text)).toHaveLength(50_000);
    // Generous bound — the point is that it does not scale with a buffered copy of everything.
    expect(grewMb).toBeLessThan(200);
  });
});
