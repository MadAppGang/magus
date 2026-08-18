#!/usr/bin/env bun
/**
 * compose-style.ts — compose communication style presets, plus any output
 * styles already on the machine, into ONE native Claude Code output style.
 *
 * Claude Code activates exactly one output style at a time (the resolver
 * returns a single object). This plugin's model is compositional — one
 * verbosity preset plus any number of modifiers — so composition has to
 * happen before the harness sees it. That is what this script does: it
 * concatenates the selected bodies into a single generated style file and
 * points the `outputStyle` setting at it.
 *
 * Discovery:
 *   presets   ${pluginRoot}/styles/*.md          (this plugin, axis model)
 *   user      ~/.claude/output-styles/*.md       (whatever the user wrote)
 *   project   <project>/.claude/output-styles/*.md
 *
 * Built-in styles (Explanatory, Learning, Proactive) are NOT imported. Their
 * text ships inside the Claude Code binary rather than on disk, so there is
 * no file to read. It is extractable by other means — see the skill's
 * "Built-in styles" section — but nothing here snapshots it, because a copy
 * goes stale silently on the next Claude Code release. Composing REPLACES
 * whichever style was active, built-in included.
 *
 * Usage:
 *   bun compose-style.ts --list [--json]
 *   bun compose-style.ts --presets direct,no-slop [--import user:my-voice]
 *                        [--global] [--name composed] [--dry-run] [--json]
 *                        [--drop-claude-md-block]
 *
 * Exit code: 1 on any error (unknown preset, two verbosity presets, failed
 * verification), else 0.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

/** Frontmatter we care about is flat scalars; nothing here needs real YAML. */
type Frontmatter = Record<string, string>;

interface Preset {
  kind: "preset";
  id: string;
  name: string;
  /** Display name for lists; the slug in `name` stays the selection key. */
  title: string;
  axis: "verbosity" | "modifier";
  summary: string;
  conflicts: string[];
  template: boolean;
  body: string;
  path: string;
}

interface Imported {
  kind: "imported";
  id: string;
  name: string;
  scope: "user" | "project";
  description: string;
  keepCodingInstructions: boolean | null;
  body: string;
  path: string;
}

type Source = Preset | Imported;

const DEFAULT_STYLE_NAME = "composed";
/** Claude Code truncates long descriptions in the picker; stay well under. */
const MAX_DESCRIPTION = 200;

// ---------------------------------------------------------------- frontmatter

export function splitFrontmatter(text: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const lines = text.replace(/^\uFEFF/, "").split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: text.trim() };
  }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return { frontmatter: {}, body: text.trim() };

  const frontmatter: Frontmatter = {};
  for (const line of lines.slice(1, close)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    frontmatter[match[1].toLowerCase()] = value;
  }

  return { frontmatter, body: lines.slice(close + 1).join("\n").trim() };
}

function asBool(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "no") return false;
  return null;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => join(dir, entry))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

// ------------------------------------------------------------------ discovery

export function discoverPresets(pluginRoot: string): Preset[] {
  return markdownFiles(join(pluginRoot, "styles")).map((path) => {
    const { frontmatter, body } = splitFrontmatter(readFileSync(path, "utf8"));
    const name = frontmatter.name || basename(path, ".md");
    const axis = frontmatter.axis === "verbosity" ? "verbosity" : "modifier";
    return {
      kind: "preset" as const,
      id: name,
      name,
      title: frontmatter.title || "",
      axis,
      summary: frontmatter.summary || "",
      conflicts: splitList(frontmatter.conflicts),
      template: asBool(frontmatter.template) === true,
      body,
      path,
    };
  });
}

export function discoverImportable(
  projectRoot: string,
  home: string,
  generatedName: string,
): Imported[] {
  const scopes: Array<{ scope: "user" | "project"; dir: string }> = [
    { scope: "user", dir: join(home, ".claude", "output-styles") },
    { scope: "project", dir: join(projectRoot, ".claude", "output-styles") },
  ];

  const found: Imported[] = [];
  for (const { scope, dir } of scopes) {
    for (const path of markdownFiles(dir)) {
      const { frontmatter, body } = splitFrontmatter(readFileSync(path, "utf8"));
      const name = frontmatter.name || basename(path, ".md");
      // Never import the file we generate — that compounds on every run.
      if (name === generatedName) continue;
      found.push({
        kind: "imported",
        id: `${scope}:${name}`,
        name,
        scope,
        description: frontmatter.description || "",
        keepCodingInstructions: asBool(frontmatter["keep-coding-instructions"]),
        body,
        path,
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------- composition

export function selectSources(
  presets: Preset[],
  importable: Imported[],
  presetIds: string[],
  importIds: string[],
): { sources: Source[]; errors: string[] } {
  const errors: string[] = [];
  const chosenPresets: Preset[] = [];

  for (const id of presetIds) {
    const match = presets.find((preset) => preset.name === id);
    if (!match) {
      const valid = presets.map((preset) => preset.name).join(", ");
      errors.push(`Unknown preset "${id}". Valid presets: ${valid}`);
      continue;
    }
    if (match.template) {
      // A template preset ships an empty table that is worthless as-is. It has
      // to be filled from the codebase first, and the filled result is a real
      // file the user can read and edit — so it goes through the import path.
      errors.push(
        `"${match.name}" is a template preset and cannot be used directly. ` +
          `Fill it in, write it to .claude/output-styles/${match.name}.md, ` +
          `then pass --import project:${match.name}.`,
      );
      continue;
    }
    if (chosenPresets.some((preset) => preset.name === match.name)) continue;
    chosenPresets.push(match);
  }

  const verbosity = chosenPresets.filter((preset) => preset.axis === "verbosity");
  if (verbosity.length > 1) {
    errors.push(
      `Pick exactly one verbosity preset. Got: ${verbosity
        .map((preset) => preset.name)
        .join(", ")}. They contradict each other and cancel out.`,
    );
  }

  for (const preset of chosenPresets) {
    for (const conflict of preset.conflicts) {
      if (chosenPresets.some((other) => other.name === conflict)) {
        errors.push(`"${preset.name}" conflicts with "${conflict}".`);
      }
    }
  }

  const chosenImports: Imported[] = [];
  for (const id of importIds) {
    const match =
      importable.find((style) => style.id === id) ??
      importable.find((style) => style.name === id);
    if (!match) {
      const valid = importable.map((style) => style.id).join(", ") || "none found";
      errors.push(`Unknown output style "${id}". Importable: ${valid}`);
      continue;
    }
    if (chosenImports.some((style) => style.id === match.id)) continue;
    chosenImports.push(match);
  }

  // Imported styles are whole personalities; presets are specific, checkable
  // rules. Specific-after-broad, so a preset rule refines an imported one
  // rather than being buried by it.
  const modifiers = chosenPresets.filter((preset) => preset.axis === "modifier");
  const sources: Source[] = [...chosenImports, ...verbosity.slice(0, 1), ...modifiers];

  return { sources, errors };
}

function describe(sources: Source[]): string {
  const names = sources.map((source) => source.name).join(", ");
  const text = `Composed communication style: ${names || "no rules selected"}`;
  const clipped =
    text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
  // The value carries ": " from the label and preset names may carry anything.
  // Unquoted, YAML reads that as a nested mapping and the frontmatter fails to
  // parse — so always quote, and escape what would close the quote.
  return `"${clipped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The shared integrity block. Appended to EVERY composition, unconditionally.
 *
 * A composed style is arbitrary instruction text assembled from several
 * sources, and the user's own imported styles are not reviewed by anyone. We
 * cannot detect prompt injection in them and will not pretend to. What we can
 * do is state, at the end of the prompt, the things style is never allowed to
 * change — so a rule that says "be brief" cannot be read as licence to trim a
 * command, and a rule that says "no hedging" cannot be read as licence to drop
 * a warning.
 *
 * It lives in the BODY, not the frontmatter, because only the body reaches the
 * model. That is a real cost paid on every request, and it is the exception to
 * the "provenance goes in frontmatter" rule below: provenance is for the human
 * reading the file, this is for the model reading the prompt.
 *
 * It goes LAST for the same reason imports come first — specific-after-broad,
 * so later text refines earlier text rather than being buried by it.
 *
 * Mirrored verbatim in claudeup's `src/services/styles-manager.ts`; a parity
 * test there reads THIS file and fails if the two drift. Edit both together.
 */
export const INTEGRITY_BLOCK = `## Style limits

These rules override everything above. Style decides how an answer is worded;
it never decides what is true.

- Never reword, shorten, or tidy code, commands, file paths, identifiers, error
  text, log output, or numbers to fit a style rule. Reproduce them exactly,
  including the parts that read badly.
- A brevity rule may cut prose. It may never cut a flag from a command, a
  segment from a path, a digit from a figure, or the line of a stack trace that
  names the failure.
- Quote real output rather than paraphrasing it. When it is too long to
  include, quote the part that decides the answer and say what was left out.
- Never soften or drop a security warning, a data-loss risk, or a caveat that
  would change what the reader does next. State it plainly, even under a rule
  that bans hedging.
- Ask before any destructive or irreversible action and name exactly what would
  be lost. No verbosity or brevity rule suppresses that confirmation.
- Say when something is unverified, failing, or unknown. A rule against filler
  bans padding, not honesty.`;

export function composeStyleFile(styleName: string, sources: Source[]): string {
  const presets = sources.filter((source): source is Preset => source.kind === "preset");
  const imports = sources.filter((source): source is Imported => source.kind === "imported");

  // Provenance goes in FRONTMATTER, not in the body. Claude Code splits the
  // file and only the body becomes the prompt, so a marker in the body is
  // paid for on every request forever. A human opening the file still reads
  // frontmatter; the model never sees it. Unknown keys are accepted — the
  // harness's validator only emits a telemetry event for them.
  const lines: string[] = [
    "---",
    `name: ${styleName}`,
    `description: ${describe(sources)}`,
    // Without this, Claude Code drops its own coding-discipline block from the
    // system prompt. A style about how to COMMUNICATE has no business
    // switching off how to write code.
    "keep-coding-instructions: true",
    'generated-by: "/style:apply. Hand edits are lost on the next run."',
    `style-presets: ${presets.map((preset) => preset.name).join(", ") || "none"}`,
    `style-imports: ${imports.map((style) => style.id).join(", ") || "none"}`,
    "---",
    "",
  ];

  for (const style of imports) {
    lines.push(`## Imported: ${style.name}`, "", style.body, "");
  }

  if (presets.length > 0) {
    lines.push("## Communication style", "");
    for (const preset of presets) {
      lines.push(preset.body, "");
    }
  }

  // Unconditional, and last. A composition with no sources still gets it —
  // there is no selection for which "do not rewrite an error message" stops
  // applying.
  lines.push(INTEGRITY_BLOCK, "");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

// -------------------------------------------------------------------- writing

export function readAppliedFromStyleFile(
  path: string,
): { presets: string[]; imports: string[] } | null {
  if (!existsSync(path)) return null;
  const { frontmatter } = splitFrontmatter(readFileSync(path, "utf8"));
  const clean = (value: string | undefined) =>
    !value || value === "none" ? [] : splitList(value);
  return {
    presets: clean(frontmatter["style-presets"]),
    imports: clean(frontmatter["style-imports"]),
  };
}

export function setOutputStyle(settingsPath: string, styleName: string): string {
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf8").trim();
    if (raw) {
      try {
        settings = JSON.parse(raw) as Record<string, unknown>;
      } catch (error) {
        throw new Error(
          `${settingsPath} is not valid JSON, refusing to overwrite it: ${String(error)}`,
        );
      }
    }
  }
  settings.outputStyle = styleName;
  return `${JSON.stringify(settings, null, 2)}\n`;
}

const LEGACY_BLOCK = /\n*<!--\s*style:begin\s*-->[\s\S]*?<!--\s*style:end\s*-->\n*/;

export function stripLegacyBlock(text: string): { text: string; found: boolean } {
  if (!LEGACY_BLOCK.test(text)) return { text, found: false };
  return { text: `${text.replace(LEGACY_BLOCK, "\n\n").trimEnd()}\n`, found: true };
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

// ----------------------------------------------------------------------- main

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      presets: { type: "string", default: "" },
      import: { type: "string", default: "" },
      name: { type: "string", default: DEFAULT_STYLE_NAME },
      global: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "drop-claude-md-block": { type: "boolean", default: false },
      "plugin-root": { type: "string" },
      "project-root": { type: "string" },
      home: { type: "string" },
    },
    allowPositionals: false,
  });

  const pluginRoot = resolve(
    values["plugin-root"] ?? process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, ".."),
  );
  const projectRoot = resolve(values["project-root"] ?? process.cwd());
  const home = resolve(values.home ?? homedir());
  const styleName = values.name || DEFAULT_STYLE_NAME;

  const presets = discoverPresets(pluginRoot);
  const importable = discoverImportable(projectRoot, home, styleName);

  const scopeRoot = values.global ? join(home, ".claude") : join(projectRoot, ".claude");
  const stylePath = join(scopeRoot, "output-styles", `${styleName}.md`);
  const settingsPath = join(scopeRoot, "settings.json");
  const claudeMdPath = values.global
    ? join(home, ".claude", "CLAUDE.md")
    : join(projectRoot, "CLAUDE.md");

  if (values.list) {
    const applied = readAppliedFromStyleFile(stylePath);
    if (values.json) {
      console.log(
        JSON.stringify(
          {
            pluginRoot,
            projectRoot,
            stylePath,
            settingsPath,
            applied,
            presets: presets.map(({ body, ...rest }) => rest),
            importable: importable.map(({ body, ...rest }) => rest),
          },
          null,
          2,
        ),
      );
      return 0;
    }

    const mark = (id: string, list: string[]) => (list.includes(id) ? "x" : " ");
    const appliedPresets = applied?.presets ?? [];
    const appliedImports = applied?.imports ?? [];

    console.log("VERBOSITY — pick exactly one");
    for (const preset of presets.filter((entry) => entry.axis === "verbosity")) {
      console.log(
        `  [${mark(preset.name, appliedPresets)}] ${preset.name.padEnd(16)}${preset.title ? `${preset.title}. ` : ""}${preset.summary}`,
      );
    }
    console.log("\nMODIFIERS — combine freely");
    for (const preset of presets.filter((entry) => entry.axis === "modifier")) {
      console.log(
        `  [${mark(preset.name, appliedPresets)}] ${preset.name.padEnd(16)}${preset.title ? `${preset.title}. ` : ""}${preset.summary}`,
      );
    }
    console.log("\nIMPORTABLE OUTPUT STYLES — already on this machine");
    if (importable.length === 0) {
      console.log("  (none in ~/.claude/output-styles or .claude/output-styles)");
    }
    const idWidth = Math.max(24, ...importable.map((style) => style.id.length + 2));
    for (const style of importable) {
      console.log(
        `  [${mark(style.id, appliedImports)}] ${style.id.padEnd(idWidth)}${style.description}`,
      );
    }
    console.log(
      `\nBuilt-in styles (Explanatory, Learning, Proactive) ship inside the Claude`,
    );
    console.log(`Code binary, so there is no file to import until one is captured:`);
    console.log(`  bun \${CLAUDE_PLUGIN_ROOT}/scripts/capture-builtin.ts --style Explanatory`);
    console.log(`Composing replaces whichever style was active, built-ins included.`);
    console.log(`\nGenerated style: ${stylePath}${existsSync(stylePath) ? "" : " (not yet written)"}`);
    return 0;
  }

  const { sources, errors } = selectSources(
    presets,
    importable,
    splitList(values.presets),
    splitList(values.import),
  );

  if (errors.length > 0) {
    for (const error of errors) console.error(`error: ${error}`);
    return 1;
  }
  if (sources.length === 0) {
    console.error("error: nothing selected. Pass --presets and/or --import.");
    return 1;
  }

  const styleFile = composeStyleFile(styleName, sources);
  const settingsFile = setOutputStyle(settingsPath, styleName);

  let legacyFound = false;
  let legacyText: string | null = null;
  if (existsSync(claudeMdPath)) {
    const result = stripLegacyBlock(readFileSync(claudeMdPath, "utf8"));
    legacyFound = result.found;
    if (result.found && values["drop-claude-md-block"]) legacyText = result.text;
  }

  if (values["dry-run"]) {
    console.log(`--- ${stylePath}`);
    console.log(styleFile);
    console.log(`--- ${settingsPath}`);
    console.log(settingsFile);
    if (legacyFound) {
      console.log(
        `--- ${claudeMdPath}\nlegacy <!-- style:begin --> block present; ` +
          `${values["drop-claude-md-block"] ? "would be removed" : "would be LEFT IN PLACE (pass --drop-claude-md-block to remove)"}`,
      );
    }
    return 0;
  }

  writeFile(stylePath, styleFile);
  writeFile(settingsPath, settingsFile);
  if (legacyText !== null) writeFile(claudeMdPath, legacyText);

  // Verify by re-reading, not by trusting the write.
  const verifyStyle = splitFrontmatter(readFileSync(stylePath, "utf8"));
  const verifySettings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  const problems: string[] = [];
  if (verifyStyle.frontmatter.name !== styleName) {
    problems.push(`style file name is "${verifyStyle.frontmatter.name}", expected "${styleName}"`);
  }
  if (asBool(verifyStyle.frontmatter["keep-coding-instructions"]) !== true) {
    problems.push("keep-coding-instructions is not true — coding rules would be dropped");
  }
  if (verifySettings.outputStyle !== styleName) {
    problems.push(`settings outputStyle is "${String(verifySettings.outputStyle)}"`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: verification failed — ${problem}`);
    return 1;
  }

  const bytes = Buffer.byteLength(styleFile, "utf8");
  const lineCount = styleFile.split("\n").length;
  const result = {
    stylePath,
    settingsPath,
    styleName,
    scope: values.global ? "global" : "project",
    presets: sources.filter((source) => source.kind === "preset").map((source) => source.name),
    imports: sources.filter((source) => source.kind === "imported").map((source) => source.id),
    lines: lineCount,
    bytes,
    legacyClaudeMdBlock: legacyFound
      ? values["drop-claude-md-block"]
        ? "removed"
        : "left in place"
      : "none",
  };

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log("STYLE COMPOSED");
  console.log("════════════════════════════════════════");
  console.log(`Style:      ${result.styleName}  (${result.scope})`);
  console.log(`Written:    ${result.stylePath}`);
  console.log(`Activated:  ${result.settingsPath}  →  "outputStyle": "${result.styleName}"`);
  console.log(`Presets:    ${result.presets.join(", ") || "none"}`);
  console.log(`Imported:   ${result.imports.join(", ") || "none"}`);
  console.log(`Size:       ${result.lines} lines, ${result.bytes} bytes`);
  console.log(`CLAUDE.md:  legacy block ${result.legacyClaudeMdBlock}`);
  console.log("════════════════════════════════════════");
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
