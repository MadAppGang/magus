import { describe, expect, test } from "bun:test";
import { childTicket } from "./ticket";

describe("child ticket inheritance [R3.3, R3.4; final child-ticket decision]", () => {
  const manager = { id: "example/product#7", url: "https://github.com/example/product/issues/7" };
  for (const given of [null, "#7", "7", "example/product#7", "EXAMPLE/PRODUCT#7", manager.url]) {
    test(`[REQ-15, REQ-16] TEST-502 keeps the manager's exact id and URL for matching child flag ${given}`, () => {
      const saved = JSON.stringify(manager);
      expect(childTicket(given, manager)).toEqual({ ok: true, ticket: manager });
      expect(JSON.stringify(manager)).toBe(saved);
    });
  }
  for (const given of ["#8", "8", "other/backend#7", "https://github.com/other/backend/issues/7", "DEMO-7"]) {
    test(`[REQ-15, REQ-16] TEST-502 rejects a conflicting child ticket ${given} instead of normalising in the child's repo`, () => {
      const result = childTicket(given, manager);
      expect(result).toEqual({ ok: false, error: expect.any(String) });
      if (!result.ok) expect(result.error).toMatch(/ticket/i);
      expect(manager.id).toBe("example/product#7");
    });
  }
  test("[REQ-15, REQ-16] TEST-502 case-insensitive key matching still carries the manager's stored ticket", () => {
    const manager = { id: "DEMO-7", url: "https://tracker.example.test/DEMO-7" };
    expect(childTicket("demo-7", manager)).toEqual({ ok: true, ticket: manager });
    expect(childTicket("DEMO-8", manager).ok).toBe(false);
  });
});
