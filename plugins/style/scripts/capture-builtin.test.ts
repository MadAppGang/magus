import { describe, expect, test } from "bun:test";

import {
  extractSection,
  normalizeVersion,
  slugFor,
  stripSectionHeader,
  toStyleFile,
} from "./capture-builtin.ts";
import { splitFrontmatter } from "./compose-style.ts";

const MARKER = "# Output Style: X";

const BASELINE = "# First\nalpha\n\n# Second\nbeta";

describe("extractSection", () => {
  test("stops at the next structural heading", () => {
    const styled = `# First\nalpha\n\n${MARKER}\nbody\n\n# Second\nbeta`;
    expect(extractSection(BASELINE, styled, MARKER)).toBe(`${MARKER}\nbody`);
  });

  test("keeps an H1 that belongs to the style, not to the harness", () => {
    // Explanatory really does ship "# Explanatory Style Active" inside its
    // own body. Splitting on the next "# " truncates it.
    const styled = `# First\nalpha\n\n${MARKER}\nbody\n\n# X Style Active\nmore\n\n# Second\nbeta`;
    const got = extractSection(BASELINE, styled, MARKER);
    expect(got).toContain("# X Style Active");
    expect(got).toContain("more");
    expect(got).not.toContain("beta");
  });

  test("does not truncate when the section ends the way the tail ends", () => {
    // A character-level suffix walk cut Explanatory mid-sentence here.
    const styled = `# First\nalpha\n\n${MARKER}\nProvide them as you write code.\n\n# Second\nbeta`;
    expect(extractSection(BASELINE, styled, MARKER)).toBe(
      `${MARKER}\nProvide them as you write code.`,
    );
  });

  test("runs to the end when the section is last", () => {
    const styled = `# First\nalpha\n\n${MARKER}\nbody`;
    expect(extractSection(BASELINE, styled, MARKER)).toBe(`${MARKER}\nbody`);
  });

  test("returns empty when the marker is absent", () => {
    expect(extractSection(BASELINE, BASELINE, MARKER)).toBe("");
  });
});

describe("stripSectionHeader", () => {
  test("removes the harness header and keeps H1s belonging to the style", () => {
    const block = "# Output Style: Explanatory\nBody line.\n\n# Explanatory Style Active\n\nMore.";
    const body = stripSectionHeader(block, "Explanatory");
    expect(body.startsWith("Body line.")).toBe(true);
    // A heading-based split would have cut here; the style owns this H1.
    expect(body).toContain("# Explanatory Style Active");
  });

  test("passes the block through when the header is absent", () => {
    expect(stripSectionHeader("  no header here  ", "Explanatory")).toBe("no header here");
  });
});

describe("toStyleFile", () => {
  test("produces an importable file with coding instructions kept", () => {
    const file = toStyleFile("Explanatory", "Body text.", "2.1.233");
    const { frontmatter, body } = splitFrontmatter(file);
    expect(frontmatter.name).toBe("builtin-explanatory");
    expect(frontmatter["keep-coding-instructions"]).toBe("true");
    expect(frontmatter.description).toBe("Captured built-in output style: Explanatory");
    expect(frontmatter["captured-from"]).toBe("2.1.233");
    expect(frontmatter["captured-style"]).toBe("Explanatory");
    expect(body).toBe("Body text.");
  });

  test("slugs a multi-word style name into a usable filename", () => {
    expect(slugFor("Explanatory")).toBe("builtin-explanatory");
    expect(slugFor("Deep Research")).toBe("builtin-deep-research");
  });
});

describe("normalizeVersion", () => {
  test("reduces the CLI banner to a bare version so --check can compare it", () => {
    expect(normalizeVersion("2.1.233 (Claude Code)")).toBe("2.1.233");
    expect(normalizeVersion("2.1.233")).toBe("2.1.233");
  });
});
