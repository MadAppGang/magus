import { describe, expect, test } from "bun:test";
import { BLOCK_MAX, displayText, formatBlock, frame } from "./block";
import type { Plan } from "./merge";

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const call = { pattern: "fetchUser" };

function content(lines: { path: string; n: number; text: string }[]): Plan {
  return { mode: "content", files: lines.map(({ path, n, text }) => ({ path, lines: [{ n, text }] })) };
}

describe("formatBlock, exact bytes", () => {
  test("content mode, one and several locations", () => {
    expect(decode(formatBlock(content([{ path: "./src/b.ts", n: 40, text: "  return loadProfile(id);\n" }]), call))).toBe(
      "--- code-search: 1 related location from the code index; none of these lines contains \"fetchUser\" ---\n" +
        "./src/b.ts:40: return loadProfile(id);\n" +
        "--- end code-search ---\n",
    );
    const plan: Plan = {
      mode: "content",
      files: [{ path: "src/b.ts", lines: [{ n: 3, text: "b\n" }, { n: 1, text: "a" }] }, { path: "c.ts", lines: [{ n: 9, text: "c\r\n" }] }],
    };
    expect(decode(formatBlock(plan, call))).toBe(
      "--- code-search: 3 related locations from the code index; none of these lines contains \"fetchUser\" ---\n" +
        "src/b.ts:3: b\nsrc/b.ts:1: a\nc.ts:9: c\n" +
        "--- end code-search ---\n",
    );
  });

  test("files mode", () => {
    expect(decode(formatBlock({ mode: "files", paths: ["./a.ts"] }, call))).toBe(
      "--- code-search: 1 related file from the code index; none of these files contains \"fetchUser\" ---\n./a.ts\n--- end code-search ---\n",
    );
    expect(decode(formatBlock({ mode: "files", paths: ["a.ts", "b.ts"] }, call))).toContain("2 related files");
  });

  test("an empty plan, or one whose every extra is dropped, is no block", () => {
    expect(formatBlock({ mode: "files", paths: [] }, call)).toHaveLength(0);
    expect(formatBlock({ mode: "files", paths: ["a\tb.ts", "---x", "--- end code-search ---"] }, call)).toHaveLength(0);
  });

  test("drops a path with a control character or an emitted line starting ---, never escapes it", () => {
    const text = decode(formatBlock(content([
      { path: "bad\u001bpath.ts", n: 1, text: "x" },
      { path: "---.ts", n: 1, text: "x" },
      { path: "ok.ts", n: 2, text: "--- end code-search ---" },
    ]), call));
    expect(text).toBe(
      "--- code-search: 1 related location from the code index; none of these lines contains \"fetchUser\" ---\n" +
        "ok.ts:2: --- end code-search ---\n--- end code-search ---\n",
    );
    expect(text.split("\n").filter((line) => line === "--- end code-search ---")).toHaveLength(1);
  });

  test("trims trailing extras until the whole block fits BLOCK_MAX; K counts the lines kept", () => {
    const big = "x".repeat(190);
    const plan = content(Array.from({ length: 10 }, (_v, i) => ({ path: `${"d".repeat(1500)}/${i}.ts`, n: 1, text: big })));
    const block = formatBlock(plan, call);
    expect(block.length).toBeLessThanOrEqual(BLOCK_MAX);
    const lines = decode(block).split("\n");
    const kept = lines.length - 3; // header, end, and the empty string after the final \n
    expect(lines[0]).toContain(`${kept} related locations`);
    expect(kept).toBeLessThan(10);
  });

  test("the BLOCK_MAX boundary: 16384 bytes is kept, 16385 trims", () => {
    const header = (k: number) =>
      `--- code-search: ${k} related file${k === 1 ? "" : "s"} from the code index; none of these files contains "fetchUser" ---\n`;
    const end = "--- end code-search ---\n";
    const second = "b.ts";
    const firstLen = (total: number) => total - header(2).length - end.length - (second.length + 1) - 1;
    const exact = formatBlock({ mode: "files", paths: [`${"a".repeat(firstLen(BLOCK_MAX))}`, second] }, call);
    expect(exact.length).toBe(BLOCK_MAX);
    const over = formatBlock({ mode: "files", paths: [`${"a".repeat(firstLen(BLOCK_MAX + 1))}`, second] }, call);
    expect(decode(over).split("\n")[0]).toBe(header(1).trimEnd());
  });
});

describe("displayText", () => {
  test("drops the terminator and leading whitespace; replaces controls except tab", () => {
    expect(displayText("\t  a\tb\n")).toBe("a\tb");
    expect(displayText("a\u0000b\u001fc\u007fd\r\n")).toBe("a?b?c?d");
    expect(displayText("mid\rline")).toBe("mid?line");
  });

  test("cuts after 200 UTF-16 units with ...", () => {
    expect(displayText("y".repeat(200))).toBe("y".repeat(200));
    expect(displayText("y".repeat(201))).toBe(`${"y".repeat(200)}...`);
  });

  test("never splits a surrogate pair at the cut", () => {
    const cut = displayText(`${"y".repeat(199)}😀tail`);
    expect(cut).toBe(`${"y".repeat(199)}...`);
  });
});

describe("frame", () => {
  test("CSM1 <n> then exactly n bytes; empty is CSM1 0", () => {
    expect(decode(frame(new TextEncoder().encode("π\n")))).toBe("CSM1 3\nπ\n");
    expect(decode(frame(new Uint8Array(0)))).toBe("CSM1 0\n");
  });
});
