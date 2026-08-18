import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  INTEGRITY_BLOCK,
  composeStyleFile,
  discoverImportable,
  discoverPresets,
  readAppliedFromStyleFile,
  selectSources,
  setOutputStyle,
  splitFrontmatter,
  stripLegacyBlock,
} from "./compose-style.ts";

const PLUGIN_ROOT = join(import.meta.dir, "..");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "style-compose-"));
}

function writeStyle(dir: string, name: string, frontmatter: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
}

describe("splitFrontmatter", () => {
  test("parses scalars and strips quotes", () => {
    const { frontmatter, body } = splitFrontmatter(
      `---\nname: direct\nsummary: "Answer first: then support"\nconflicts:\n---\n\n### Direct\n\n- Lead.\n`,
    );
    expect(frontmatter.name).toBe("direct");
    expect(frontmatter.summary).toBe("Answer first: then support");
    expect(frontmatter.conflicts).toBe("");
    expect(body).toBe("### Direct\n\n- Lead.");
  });

  test("treats a file without frontmatter as all body", () => {
    const { frontmatter, body } = splitFrontmatter("# Just a prompt\n\nDo the thing.\n");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just a prompt\n\nDo the thing.");
  });

  test("treats an unterminated delimiter as all body", () => {
    const { frontmatter, body } = splitFrontmatter("---\nname: broken\n\nno close\n");
    expect(frontmatter).toEqual({});
    expect(body).toContain("no close");
  });
});

describe("discovery", () => {
  test("reads the shipped presets and their axes", () => {
    const presets = discoverPresets(PLUGIN_ROOT);
    const names = presets.map((preset) => preset.name).sort();
    expect(names).toContain("direct");
    expect(names).toContain("no-slop");

    const verbosity = presets.filter((preset) => preset.axis === "verbosity").map((p) => p.name);
    expect(verbosity.sort()).toEqual(["direct", "explanatory", "terse"]);
    for (const preset of presets) expect(preset.body.length).toBeGreaterThan(0);
  });

  test("finds user and project output styles, and skips the generated one", () => {
    const root = scratch();
    writeStyle(join(root, "home", ".claude", "output-styles"), "my-voice", "name: my-voice\ndescription: Mine", "Speak plainly.");
    writeStyle(join(root, "proj", ".claude", "output-styles"), "house", "name: house\ndescription: House", "House rules.");
    writeStyle(join(root, "proj", ".claude", "output-styles"), "composed", "name: composed\ndescription: Generated", "Generated body.");

    const found = discoverImportable(join(root, "proj"), join(root, "home"), "composed");
    expect(found.map((style) => style.id).sort()).toEqual(["project:house", "user:my-voice"]);
  });

  test("returns nothing when the directories are absent", () => {
    const root = scratch();
    expect(discoverImportable(join(root, "proj"), join(root, "home"), "composed")).toEqual([]);
  });
});

describe("selectSources", () => {
  const presets = discoverPresets(PLUGIN_ROOT);

  test("rejects two verbosity presets", () => {
    const { errors } = selectSources(presets, [], ["direct", "terse"], []);
    expect(errors.join(" ")).toContain("exactly one verbosity preset");
  });

  test("rejects a declared conflict", () => {
    const { errors } = selectSources(presets, [], ["terse", "plain-language"], []);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("rejects an unknown preset and lists the valid set", () => {
    const { errors } = selectSources(presets, [], ["dirct"], []);
    expect(errors[0]).toContain('Unknown preset "dirct"');
    expect(errors[0]).toContain("direct");
  });

  test("orders imports first, then verbosity, then modifiers", () => {
    const imported = [
      {
        kind: "imported" as const,
        id: "user:mine",
        name: "mine",
        scope: "user" as const,
        description: "",
        keepCodingInstructions: null,
        body: "Imported body.",
        path: "/tmp/mine.md",
      },
    ];
    const { sources, errors } = selectSources(
      presets,
      imported,
      ["no-slop", "direct"],
      ["user:mine"],
    );
    expect(errors).toEqual([]);
    expect(sources.map((source) => source.name)).toEqual(["mine", "direct", "no-slop"]);
  });

  test("refuses a template preset and names the import path instead", () => {
    const { errors } = selectSources(presets, [], ["terminology"], []);
    expect(errors[0]).toContain("template preset");
    expect(errors[0]).toContain("--import project:terminology");
  });

  test("deduplicates a repeated selection", () => {
    const { sources } = selectSources(presets, [], ["direct", "direct"], []);
    expect(sources).toHaveLength(1);
  });
});

describe("composeStyleFile", () => {
  const presets = discoverPresets(PLUGIN_ROOT);

  test("always sets keep-coding-instructions so coding rules survive", () => {
    const { sources } = selectSources(presets, [], ["direct"], []);
    const file = composeStyleFile("composed", sources);
    const { frontmatter } = splitFrontmatter(file);
    expect(frontmatter["keep-coding-instructions"]).toBe("true");
    expect(frontmatter.name).toBe("composed");
  });

  test("records provenance that round-trips through readAppliedFromStyleFile", () => {
    const imported = [
      {
        kind: "imported" as const,
        id: "user:mine",
        name: "mine",
        scope: "user" as const,
        description: "",
        keepCodingInstructions: null,
        body: "Imported body.",
        path: "/tmp/mine.md",
      },
    ];
    const { sources } = selectSources(presets, imported, ["direct", "no-slop"], ["user:mine"]);
    const root = scratch();
    const path = join(root, "composed.md");
    writeFileSync(path, composeStyleFile("composed", sources), "utf8");

    expect(readAppliedFromStyleFile(path)).toEqual({
      presets: ["direct", "no-slop"],
      imports: ["user:mine"],
    });
  });

  test("carries the preset bodies through verbatim", () => {
    const { sources } = selectSources(presets, [], ["no-slop"], []);
    const file = composeStyleFile("composed", sources);
    const noSlop = presets.find((preset) => preset.name === "no-slop");
    expect(file).toContain(noSlop!.body);
  });

  test("quotes the description so its colon cannot break YAML", () => {
    const { sources } = selectSources(presets, [], ["direct", "no-slop"], []);
    const file = composeStyleFile("composed", sources);
    const line = file.split("\n").find((entry) => entry.startsWith("description:"));
    expect(line).toBe('description: "Composed communication style: direct, no-slop"');
    expect(splitFrontmatter(file).frontmatter.description).toBe(
      "Composed communication style: direct, no-slop",
    );
  });

  test("reports none rather than omitting the provenance keys", () => {
    const { sources } = selectSources(presets, [], ["direct"], []);
    const file = composeStyleFile("composed", sources);
    expect(splitFrontmatter(file).frontmatter["style-imports"]).toBe("none");
  });

  test("appends the integrity block to every composition, whatever is selected", () => {
    // "Every" is the point: there is no selection for which "do not rewrite an
    // error message" stops applying, so the block is unconditional rather than
    // something a preset opts into.
    const selections: string[][] = [["direct"], ["no-slop"], ["direct", "no-slop"]];
    for (const presetIds of selections) {
      const { sources } = selectSources(presets, [], presetIds, []);
      const { body } = splitFrontmatter(composeStyleFile("composed", sources));
      expect(body, `selection ${presetIds.join("+")} carries the block`).toContain(
        INTEGRITY_BLOCK,
      );
      // Last, so it refines everything before it rather than being buried.
      expect(body.trimEnd().endsWith(INTEGRITY_BLOCK)).toBe(true);
    }
  });

  test("carries the integrity block even when nothing is selected", () => {
    const { body } = splitFrontmatter(composeStyleFile("composed", []));
    expect(body).toContain(INTEGRITY_BLOCK);
  });

  test("keeps provenance out of the body, which is the part that becomes the prompt", () => {
    const { sources } = selectSources(presets, [], ["direct"], []);
    const { body } = splitFrontmatter(composeStyleFile("composed", sources));
    expect(body).not.toContain("style:apply");
    expect(body).not.toContain("style-presets");
    expect(body).not.toContain("<!--");
    expect(body.startsWith("## Communication style")).toBe(true);
  });
});

describe("setOutputStyle", () => {
  test("creates the key when the file does not exist", () => {
    const root = scratch();
    const written = setOutputStyle(join(root, "settings.json"), "composed");
    expect(JSON.parse(written)).toEqual({ outputStyle: "composed" });
  });

  test("preserves unrelated keys", () => {
    const root = scratch();
    const path = join(root, "settings.json");
    writeFileSync(path, JSON.stringify({ model: "opus", enabledPlugins: { "style@magus": true } }), "utf8");
    const parsed = JSON.parse(setOutputStyle(path, "composed"));
    expect(parsed.model).toBe("opus");
    expect(parsed.enabledPlugins).toEqual({ "style@magus": true });
    expect(parsed.outputStyle).toBe("composed");
  });

  test("refuses to overwrite malformed JSON", () => {
    const root = scratch();
    const path = join(root, "settings.json");
    writeFileSync(path, "{ not json", "utf8");
    expect(() => setOutputStyle(path, "composed")).toThrow(/not valid JSON/);
  });
});

describe("stripLegacyBlock", () => {
  test("removes the managed CLAUDE.md block and leaves the rest", () => {
    const text = [
      "# Project",
      "",
      "Some rules.",
      "",
      "<!-- style:begin -->",
      "<!-- presets: direct -->",
      "## Communication style",
      "<!-- style:end -->",
      "",
      "Trailing content.",
      "",
    ].join("\n");
    const result = stripLegacyBlock(text);
    expect(result.found).toBe(true);
    expect(result.text).toContain("Some rules.");
    expect(result.text).toContain("Trailing content.");
    expect(result.text).not.toContain("style:begin");
  });

  test("is a no-op when there is no block", () => {
    const text = "# Project\n\nNothing managed here.\n";
    expect(stripLegacyBlock(text)).toEqual({ text, found: false });
  });
});

describe("end to end", () => {
  test("writes a style file and activates it in settings", async () => {
    const root = scratch();
    const projectRoot = join(root, "proj");
    const home = join(root, "home");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(home, { recursive: true });
    writeStyle(join(home, ".claude", "output-styles"), "my-voice", "name: my-voice\ndescription: Mine", "Speak plainly.");

    const proc = Bun.spawnSync([
      "bun",
      join(import.meta.dir, "compose-style.ts"),
      "--presets", "direct,no-slop",
      "--import", "user:my-voice",
      "--project-root", projectRoot,
      "--home", home,
      "--plugin-root", PLUGIN_ROOT,
      "--json",
    ]);
    expect(proc.exitCode).toBe(0);

    const result = JSON.parse(proc.stdout.toString());
    expect(result.presets).toEqual(["direct", "no-slop"]);
    expect(result.imports).toEqual(["user:my-voice"]);

    const style = splitFrontmatter(readFileSync(result.stylePath, "utf8"));
    expect(style.frontmatter["keep-coding-instructions"]).toBe("true");
    expect(style.body).toContain("Speak plainly.");

    const settings = JSON.parse(readFileSync(result.settingsPath, "utf8"));
    expect(settings.outputStyle).toBe("composed");
  });

  test("exits non-zero on two verbosity presets and writes nothing", () => {
    const root = scratch();
    const proc = Bun.spawnSync([
      "bun",
      join(import.meta.dir, "compose-style.ts"),
      "--presets", "direct,terse",
      "--project-root", root,
      "--home", root,
      "--plugin-root", PLUGIN_ROOT,
    ]);
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("exactly one verbosity preset");
    expect(() => readFileSync(join(root, ".claude", "settings.json"))).toThrow();
  });

  test("--dry-run writes nothing", () => {
    const root = scratch();
    const proc = Bun.spawnSync([
      "bun",
      join(import.meta.dir, "compose-style.ts"),
      "--presets", "direct",
      "--project-root", root,
      "--home", root,
      "--plugin-root", PLUGIN_ROOT,
      "--dry-run",
    ]);
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("keep-coding-instructions: true");
    expect(() => readFileSync(join(root, ".claude", "settings.json"))).toThrow();
  });
});
