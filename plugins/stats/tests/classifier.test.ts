import { describe, test, expect } from "bun:test";
import { classifyTool } from "../lib/classifier.ts";

describe("classifyTool", () => {
  test("research tools", () => {
    expect(classifyTool("Read")).toBe("research");
    expect(classifyTool("Grep")).toBe("research");
    expect(classifyTool("Glob")).toBe("research");
    expect(classifyTool("WebFetch")).toBe("research");
    expect(classifyTool("WebSearch")).toBe("research");
  });

  test("mcp__ tools are research", () => {
    expect(classifyTool("mcp__mnemex__search")).toBe("research");
    expect(classifyTool("mcp__web__fetch")).toBe("research");
  });

  test("coding tools", () => {
    expect(classifyTool("Write")).toBe("coding");
    expect(classifyTool("Edit")).toBe("coding");
    expect(classifyTool("MultiEdit")).toBe("coding");
  });

  test("delegation tools", () => {
    expect(classifyTool("Task")).toBe("delegation");
  });

  test("Bash without command is other", () => {
    expect(classifyTool("Bash")).toBe("other");
    expect(classifyTool("Bash", undefined)).toBe("other");
  });

  test("Bash test commands are testing", () => {
    expect(classifyTool("Bash", "bun test")).toBe("testing");
    expect(classifyTool("Bash", "npm test")).toBe("testing");
    expect(classifyTool("Bash", "go test ./...")).toBe("testing");
    expect(classifyTool("Bash", "pytest tests/")).toBe("testing");
    expect(classifyTool("Bash", "cargo test")).toBe("testing");
    expect(classifyTool("Bash", "bun run test")).toBe("testing");
    expect(classifyTool("Bash", "bun run lint")).toBe("testing");
    expect(classifyTool("Bash", "bun run check")).toBe("testing");
    expect(classifyTool("Bash", "npx jest --coverage")).toBe("testing");
    expect(classifyTool("Bash", "vitest run")).toBe("testing");
  });

  test("Bash build commands are coding", () => {
    expect(classifyTool("Bash", "bun build src/index.ts")).toBe("coding");
    expect(classifyTool("Bash", "npm run build")).toBe("coding");
    expect(classifyTool("Bash", "tsc --noEmit")).toBe("coding");
    expect(classifyTool("Bash", "go build ./...")).toBe("coding");
    expect(classifyTool("Bash", "cargo build --release")).toBe("coding");
  });

  test("Bash misc commands are other", () => {
    expect(classifyTool("Bash", "ls -la")).toBe("other");
    expect(classifyTool("Bash", "git status")).toBe("other");
    expect(classifyTool("Bash", "echo hello")).toBe("other");
  });

  test("unknown tools are other", () => {
    expect(classifyTool("UnknownTool")).toBe("other");
    expect(classifyTool("AskUser")).toBe("other");
    expect(classifyTool("")).toBe("other");
  });
});
