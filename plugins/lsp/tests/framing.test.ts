import { expect, test } from "bun:test";
import { FrameParser, requestKey, responseKey } from "../src/framing.ts";
import { frame } from "./wire.ts";

test("REQ-2 parser preserves exact UTF-8 bytes across split chunks and returns multiple frames in order", () => {
  const first = frame(' { "id": 1, "method": "café" } ');
  const second = frame({ id: 1, result: "☃" });
  const parser = new FrameParser();
  const head = parser.push(first.subarray(0, first.indexOf("\r\n\r\n") + 2));
  expect(head.error).toBeNull();
  expect(head.frames).toEqual([]);
  expect(parser.partial).toBe(true);
  const rest = parser.push(Buffer.concat([first.subarray(first.indexOf("\r\n\r\n") + 2), second]));
  expect(rest.error).toBeNull();
  expect(rest.frames.map(f => Buffer.from(f.bytes))).toEqual([first, second]);
  expect(rest.frames.map(f => f.message)).toEqual([{ id: 1, method: "café" }, { id: 1, result: "☃" }]);
  expect(parser.partial).toBe(false);
});

test("REQ-2 64 KiB of header is allowed and 64 KiB + 1 is refused across all delimiter splits", () => {
  for (const size of [65_536, 65_537]) {
    const prefix = "Content-Length: 2\r\nX-Padding: ";
    const header = prefix + "a".repeat(size - prefix.length);
    const wire = Buffer.from(header + "\r\n\r\n{}");
    for (const split of [0, 1, 2, 3, 4]) {
      const parser = new FrameParser();
      const a = parser.push(wire.subarray(0, size + split));
      if (size > 65_536 && a.error) continue;
      expect(a.error).toBeNull();
      const b = parser.push(wire.subarray(size + split));
      if (size === 65_536) {
        expect(b.error).toBeNull();
        expect(b.frames.map(f => Buffer.from(f.bytes))).toEqual([wire]);
      } else {
        expect(b.error).toEqual(expect.any(String));
        expect(b.frames).toEqual([]);
      }
    }
  }
});

test("REQ-2 invalid JSON returns the valid prefix and the exact unparsed suffix", () => {
  const valid = frame({ method: "first" });
  const invalid = frame("{not JSON}");
  const after = frame({ method: "exit" });
  const result = new FrameParser().push(Buffer.concat([valid, invalid, after]));
  expect(result.frames.map(f => Buffer.from(f.bytes))).toEqual([valid]);
  expect(result.error).toEqual(expect.any(String));
  expect(Buffer.from(result.rest)).toEqual(Buffer.concat([invalid, after]));
});

test("REQ-3 response keys settle matching requests, not notifications or reverse requests", () => {
  expect(requestKey({ id: 1, method: "hover" })).toBe("1");
  expect(requestKey({ id: "1", method: "hover" })).toBe('"1"');
  expect(requestKey({ method: "hover" })).toBeNull();
  expect(requestKey({ id: 1, result: null })).toBeNull();
  expect(responseKey({ id: "1", method: "workspace/configuration" })).toBeNull();
  expect(responseKey({ id: 1, error: { code: -1 } })).toBe("1");
  expect(responseKey({ result: "no id" })).toBeNull();
});
