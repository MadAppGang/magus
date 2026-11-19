// magus writes `conventions.gitignore.project` into each project's ignore file and inserts
// the `conventions.claudemd` template between its BEGIN/END markers. The setup skill must
// write that same block, or the two writers drift and CLAUDE.md gains a second section.
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "../mcp/adapters/catalog";

const ROOT = join(import.meta.dir, "..");

interface Conventions {
  gitignore: { project: string[]; global?: string[] };
  claudemd: { section: string; template: string; version: string };
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"),
) as { conventions: Conventions };
const conventions = manifest.conventions;
const projectList = conventions.gitignore.project;

function catalogDirs(): string[] {
  const dirs: string[] = [];
  for (const entry of Object.values(CATALOG)) {
    const marker = entry.projectStep?.marker;
    if (marker) dirs.push(`${marker.split("/")[0]}/`);
  }
  return dirs;
}

function readTemplate(): string {
  return readFileSync(join(ROOT, conventions.claudemd.template), "utf8");
}

describe("code-search conventions", () => {
  it("lists every catalog project-step directory in the project ignore list", () => {
    const dirs = catalogDirs();
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) expect(projectList).toContain(dir);
  });

  it("lists exactly the catalog directories plus .serena/cache/", () => {
    const expected = new Set([...catalogDirs(), ".serena/cache/"]);
    expect(new Set(projectList)).toEqual(expected);
    expect(projectList.length).toBe(expected.size);
  });

  it("ships exactly one template, the one claudemd names", () => {
    const files = readdirSync(join(ROOT, "templates"));
    const named = conventions.claudemd.template.split("/").pop();
    expect(files).toEqual([named as string]);
    expect(existsSync(join(ROOT, conventions.claudemd.template))).toBe(true);
  });

  it("template names every ignore entry, carries no markers, and holds the routing rules", () => {
    const template = readTemplate();
    for (const entry of projectList) expect(template).toContain(`\`${entry}\``);
    expect(template).not.toContain("<!-- BEGIN magus:");
    expect(template).not.toContain("<!-- END magus:");
    expect(template).toMatch(/^### Routing$/m);
    expect(template).toMatch(/^### The tool surface$/m);
  });

  it("bumps the claudemd version so magus replaces existing blocks", () => {
    const version = conventions.claudemd.version;
    expect(version).not.toBe("2.0.0");
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    expect(match).not.toBeNull();
    const [major, minor, patch] = (match as RegExpExecArray).slice(1).map(Number);
    const greater = major !== 2 ? major > 2 : minor !== 0 ? minor > 0 : patch > 0;
    expect(greater).toBe(true);
  });

  it("setup skill writes the conventions template between magus markers", () => {
    const skill = readFileSync(join(ROOT, "skills", "setup", "SKILL.md"), "utf8");
    expect(skill).not.toContain("claude-md-rules.md");
    expect(skill).toContain("claude-md-conventions.md");
    expect(skill).toContain("<!-- BEGIN magus:code-search v");
    expect(skill).toContain("<!-- END magus:code-search -->");
  });
});
