#!/usr/bin/env bun
/**
 * audit-ui.ts — design-system guardrails audit.
 *
 * Dependency-free scan of a frontend repo for style-drift violations:
 *
 *   [E] hardcoded-color      hex / rgb() / hsl() / oklch() literals outside token files
 *   [E] arbitrary-value      Tailwind arbitrary values like w-[347px], bg-[#fff]
 *                            (layout-ish grid/col/row arbitraries downgraded to warning)
 *   [E] inline-style         style= / :style= attributes (CSS-var passthrough downgraded)
 *   [W] appearance-override  appearance classes (bg-, rounded-, shadow-, p-…) passed to
 *                            a Capitalized component at a call site — should be a variant
 *                            (layout primitives and imported icon components are exempt)
 *   [W] raw-palette          primitive palette classes (bg-blue-500) — prefer semantic tokens
 *   [W] missing-story        library component file without a matching *.stories.* file
 *
 * Usage:
 *   bun audit-ui.ts [path...] [--json] [--max N] [--allow GLOB ...] [--lib PATH ...]
 *                   [--layout-components A,B,C] [--skip check1,check2]
 *
 * Exit code: 1 if any errors found (CI-friendly), else 0.
 * Heuristic by design — it flags for review; it does not prove correctness.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const SCAN_EXTS = new Set([
  ".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs", ".vue", ".svelte",
  ".astro", ".html", ".css", ".scss", ".sass", ".less", ".mdx",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  ".svelte-kit", "coverage", "storybook-static", ".storybook", "public",
  "vendor", ".turbo", ".cache", ".venv", "__pycache__", "target", ".output",
]);

/** Files where raw values are the point (token definitions / theme entry). */
const DEFAULT_ALLOW = [
  "tokens.*", "*.tokens.*", "theme.*", "*.theme.*", "tailwind.config.*",
  "app.css", "globals.css", "global.css", "index.css", "main.css",
  "variables.css", "preview.*",
];

/** Library components allowed to receive className freely (layout primitives). */
const DEFAULT_LAYOUT_COMPONENTS = [
  "Box", "Stack", "HStack", "VStack", "Grid", "Flex",
  "Container", "Spacer", "Center", "Section",
];

const CSS_EXTS = new Set([".css", ".scss", ".sass", ".less"]);
const JSX_EXTS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".astro", ".mdx"]);

// --- regexes ---------------------------------------------------------------

const HEX_RE = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F\w-])/;
const COLOR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab)\(/;
const INLINE_STYLE_RE = /(?<!<)\bstyle\s*=\s*["'{]|:style\s*=/;
const CLASS_ATTR_RE = /(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:cn\(|clsx\(|cva\()?\s*[`"']([^`"']*)[`"'])/;
const COMPONENT_TAG_RE = /<([A-Z][A-Za-z0-9.]*)\b/;
const PALETTE_RE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/;

/** Matches a *utility* that carries an arbitrary value: `w-[347px]`, `bg-[#fff]`. */
const UTILITY_ARBITRARY_RE = /^-?!?([a-zA-Z][\w./-]*)-\[[^\]]{1,80}\]/;
const LAYOUT_ARBITRARY_PREFIX = /^(?:grid|col|row|auto|basis|order|aspect|minmax)/;

const TEXT_LAYOUT_UTILS = new Set([
  "left", "center", "right", "justify", "start", "end", "balance",
  "pretty", "wrap", "nowrap", "clip", "ellipsis", "truncate",
]);
const APPEARANCE_PREFIXES = [
  "bg-", "border", "rounded", "shadow", "font-", "ring-", "fill-",
  "stroke-", "opacity-", "leading-", "tracking-", "underline",
  "italic", "uppercase", "lowercase", "capitalize", "backdrop-",
  "divide-", "outline-", "decoration-",
];
const PADDING_RE = /^p[trblxyes]?-/;
const STATE_PREFIX_RE = /^(?:hover|focus|focus-visible|active|disabled|dark|group-hover|peer-|aria-|data-)[:[]/;

/**
 * Icon packages whose components take colour and size *through* className —
 * that is their documented API, not a call-site restyle. Flagging
 * `<ChevronDown className="text-muted" />` is noise, and noise is what gets an
 * audit ignored.
 */
const ICON_MODULE_RE =
  /^(?:lucide-react|lucide-vue-next|lucide-svelte|react-icons|phosphor-react|react-feather)(?:\/|$)|^(?:@heroicons|@tabler|@phosphor-icons|@radix-ui\/react-icons|@lucide)\//;
const IMPORT_RE = /import\s+(?:type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;

/** Component names this file imported from a known icon package. */
function iconComponents(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(IMPORT_RE)) {
    const clause = m[1]!;
    if (!ICON_MODULE_RE.test(m[2]!)) continue;
    for (const part of clause.replace(/[{}]/g, ",").split(",")) {
      // handles `A`, `{ A, B }`, `{ A as B }`, `Default, { A }`
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Z]/.test(name)) names.add(name);
    }
  }
  return names;
}

// --- Tailwind class parsing ------------------------------------------------

/**
 * Split a Tailwind class into its variant chain and its final utility.
 *
 * This is the distinction a shape-only regex cannot make: `data-[state=open]`
 * and `w-[347px]` are both `prefix-[…]`, but the first is a *condition* (a
 * variant selector) and the second is a *declaration* (an arbitrary value).
 * Variants sit to the left of an unbracketed `:`; the utility is what remains.
 *
 *   "data-[state=open]:md:bg-primary" → variants ["data-[state=open]", "md"], utility "bg-primary"
 *   "md:w-[347px]"                    → variants ["md"],                      utility "w-[347px]"
 *   "[&_svg]:size-4"                  → variants ["[&_svg]"],                 utility "size-4"
 *
 * Bracket depth is tracked so a `:` inside `[…]` (as in `[&[data-x]:hover]`)
 * never splits.
 */
function splitVariants(token: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) {
      parts.push(token.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(token.slice(start));
  return { variants: parts.slice(0, -1), utility: parts[parts.length - 1]! };
}

/**
 * Pull class-like tokens out of a source line. Whitespace and quotes are the
 * only separators, so parens inside an arbitrary value survive intact
 * (`w-[calc(100%-1rem)]`, `bg-[url(/a.png)]`).
 */
function classTokens(line: string): string[] {
  const out: string[] = [];
  for (const raw of line.split(/[\s"'`]+/)) {
    const token = raw.replace(/^[({]+/, "").replace(/[,;)}]+$/, "");
    if (token.includes("-[")) out.push(token);
  }
  return out;
}

function isAppearanceClass(cls: string): boolean {
  const trimmed = cls.trim();
  if (!trimmed) return false;
  // States/dark-mode handling belongs inside the component.
  if (STATE_PREFIX_RE.test(trimmed)) return true;
  const segments = trimmed.split(":");
  const base = segments[segments.length - 1]!; // strip responsive prefixes like md:
  if (base.startsWith("text-")) {
    const rest = base.slice(5);
    return !TEXT_LAYOUT_UTILS.has(rest.split("-")[0]!);
  }
  // Padding is part of the component's proportions (a size variant).
  if (PADDING_RE.test(base)) return true;
  return APPEARANCE_PREFIXES.some((p) => base.startsWith(p));
}

/** Minimal glob matcher for the filename patterns used by --allow / --lib. */
function globToRe(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(name));
}

// --- findings --------------------------------------------------------------

type Severity = "error" | "warning";

interface Finding {
  check: string;
  severity: Severity;
  file: string;
  line: number;
  snippet: string;
  message: string;
}

function addFinding(
  findings: Finding[],
  check: string,
  severity: Severity,
  file: string,
  line: number,
  snippet: string,
  message: string,
): void {
  findings.push({ check, severity, file, line, snippet: snippet.slice(0, 120), message });
}

// --- scanning --------------------------------------------------------------

function walk(root: string): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue; // prune, don't walk then filter
        dirs.push(full);
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  files.sort();
  dirs.sort();
  return { files, dirs };
}

interface ScanOptions {
  allow: RegExp[];
  layoutComponents: Set<string>;
  skip: Set<string>;
}

function scanFile(path: string, rel: string, opts: ScanOptions, findings: Finding[]): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const name = basename(path);
  const ext = path.slice(path.lastIndexOf("."));
  const allowedValues = matchesAny(name, opts.allow);
  const jsxLike = JSX_EXTS.has(ext);
  const cssLike = CSS_EXTS.has(ext);
  const isStory = name.includes(".stories.");
  const exemptFromOverride = jsxLike && !isStory
    ? new Set([...opts.layoutComponents, ...iconComponents(text)])
    : opts.layoutComponents;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const stripped = line.trim();

    // 1. hardcoded colors
    if (!opts.skip.has("hardcoded-color") && !allowedValues && !line.includes("url(")) {
      // In CSS, `#abc { … }` is an id selector, not a color. Colors only ever
      // appear in value position — to the right of the first `:` on the line.
      const hexScope = cssLike && line.includes(":")
        ? line.slice(line.indexOf(":") + 1)
        : cssLike
          ? "" // selector-only line: no declaration, so no color value
          : line;
      if (HEX_RE.test(hexScope) || COLOR_FN_RE.test(line)) {
        addFinding(findings, "hardcoded-color", "error", rel, lineNo, stripped,
          "raw color literal — use a design token");
      }
    }

    // 2. Tailwind arbitrary values (variant selectors are conditions, not values)
    if (!opts.skip.has("arbitrary-value") && !allowedValues) {
      for (const token of classTokens(line)) {
        const { utility } = splitVariants(token);
        const m = UTILITY_ARBITRARY_RE.exec(utility);
        if (!m) continue;
        if (LAYOUT_ARBITRARY_PREFIX.test(utility)) {
          addFinding(findings, "arbitrary-value", "warning", rel, lineNo, utility,
            "layout arbitrary value — consider a theme token");
        } else {
          addFinding(findings, "arbitrary-value", "error", rel, lineNo, utility,
            "arbitrary value — add a token to the theme instead");
        }
      }
    }

    // 3. inline styles
    if (!opts.skip.has("inline-style") && (jsxLike || ext === ".html")) {
      if (INLINE_STYLE_RE.test(line) && !line.includes("<style")) {
        const isVarPassthrough = line.includes("--");
        addFinding(findings, "inline-style", isVarPassthrough ? "warning" : "error",
          rel, lineNo, stripped,
          isVarPassthrough
            ? "CSS-variable passthrough — verify it's the only use"
            : "inline style — use tokens/variants");
      }
    }

    // 4. appearance classes passed to components at call sites
    if (!opts.skip.has("appearance-override") && jsxLike && !isStory) {
      const tag = COMPONENT_TAG_RE.exec(line);
      const attr = CLASS_ATTR_RE.exec(line);
      if (tag && attr && tag.index < attr.index) {
        const componentName = tag[1]!.split(".").pop()!;
        if (!exemptFromOverride.has(componentName)) {
          const classes = attr[1] ?? attr[2] ?? attr[3] ?? "";
          const bad = classes.split(/\s+/).filter((c) => c && isAppearanceClass(c));
          if (bad.length) {
            addFinding(findings, "appearance-override", "warning", rel, lineNo,
              `<${componentName} className="…${bad.slice(0, 4).join(" ")}…">`,
              "appearance styling on a component call site — move into a variant");
          }
        }
      }
    }

    // 5. primitive palette classes
    if (!opts.skip.has("raw-palette") && !allowedValues) {
      const m = PALETTE_RE.exec(line);
      if (m) {
        addFinding(findings, "raw-palette", "warning", rel, lineNo, m[0],
          "primitive palette class — prefer a semantic token");
      }
    }
  }
}

const STORY_COMPONENT_EXTS = new Set([".tsx", ".jsx", ".vue", ".svelte"]);

function checkMissingStories(
  root: string,
  dirs: string[],
  files: string[],
  libGlobs: string[],
  skip: Set<string>,
  findings: Finding[],
): void {
  if (skip.has("missing-story")) return;

  const libRes = libGlobs.map(globToRe);
  const libDirs = dirs.filter((d) => {
    const rel = relative(root, d).split("\\").join("/");
    return libGlobs.some((g) => rel.includes(g)) || matchesAny(rel, libRes);
  });
  if (!libDirs.length) return;

  const storyStems = new Set<string>();
  for (const f of files) {
    const name = basename(f);
    if (name.includes(".stories.")) storyStems.add(name.split(".stories.")[0]!.toLowerCase());
  }

  for (const f of files) {
    if (!libDirs.some((d) => f.startsWith(d + "/"))) continue;
    const ext = f.slice(f.lastIndexOf("."));
    if (!STORY_COMPONENT_EXTS.has(ext)) continue;
    const name = basename(f);
    if (name.includes(".stories.") || name.includes(".test.") || name.includes(".spec.")
      || name.startsWith("index.") || name.startsWith("use-") || name.endsWith(".d.ts")) {
      continue;
    }
    const stem = name.slice(0, name.lastIndexOf(".")).toLowerCase();
    if (!storyStems.has(stem)) {
      addFinding(findings, "missing-story", "warning", relative(root, f), 0, name,
        "library component has no *.stories.* file");
    }
  }
}

// --- main ------------------------------------------------------------------

const CHECK_ORDER = [
  "hardcoded-color", "arbitrary-value", "inline-style",
  "appearance-override", "raw-palette", "missing-story",
];

function main(): void {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      max: { type: "string", default: "15" },
      allow: { type: "string", multiple: true, default: [] },
      lib: { type: "string", multiple: true, default: [] },
      "layout-components": { type: "string", default: "" },
      skip: { type: "string", default: "" },
    },
  });

  const roots = (positionals.length ? positionals : ["."]).map((p) => resolve(p));
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      console.error(`path not found: ${root}`);
      process.exit(2);
    }
  }

  const opts: ScanOptions = {
    allow: [...DEFAULT_ALLOW, ...values.allow].map(globToRe),
    layoutComponents: new Set([
      ...DEFAULT_LAYOUT_COMPONENTS,
      ...values["layout-components"].split(",").map((s) => s.trim()).filter(Boolean),
    ]),
    skip: new Set(values.skip.split(",").map((s) => s.trim()).filter(Boolean)),
  };
  const libGlobs = values.lib.length ? values.lib : ["components/ui", "design-system", "packages/ui"];
  const maxShown = Number.parseInt(values.max, 10) || 15;

  const t0 = performance.now();
  const findings: Finding[] = [];
  let filesScanned = 0;

  for (const root of roots) {
    const isFile = statSync(root).isFile();
    const { files, dirs } = isFile ? { files: [root], dirs: [] } : walk(root);
    const base = isFile ? resolve(root, "..") : root;
    for (const f of files) {
      const ext = f.slice(f.lastIndexOf("."));
      if (!SCAN_EXTS.has(ext.toLowerCase())) continue;
      filesScanned++;
      scanFile(f, relative(base, f), opts, findings);
    }
    if (!isFile) checkMissingStories(root, dirs, files, libGlobs, opts.skip, findings);
  }

  const elapsed = Math.round(performance.now() - t0);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  if (values.json) {
    console.log(JSON.stringify({
      roots, files_scanned: filesScanned, ms: elapsed,
      errors: errors.length, warnings: warnings.length, findings,
    }, null, 2));
  } else {
    console.log(`UI Guardrails Audit — ${roots.join(", ")}`);
    console.log(`Scanned ${filesScanned} files in ${elapsed} ms\n`);
    const byCheck = new Map<string, Finding[]>();
    for (const f of findings) {
      if (!byCheck.has(f.check)) byCheck.set(f.check, []);
      byCheck.get(f.check)!.push(f);
    }
    for (const check of CHECK_ORDER) {
      const items = byCheck.get(check);
      if (!items?.length) continue;
      const sev = items.some((i) => i.severity === "error") ? "E" : "W";
      console.log(`[${sev}] ${check} (${items.length})`);
      for (const f of items.slice(0, maxShown)) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        console.log(`    ${loc}  ${f.snippet}`);
        console.log(`        → ${f.message}`);
      }
      if (items.length > maxShown) {
        console.log(`    … +${items.length - maxShown} more (raise with --max)`);
      }
      console.log();
    }
    if (!findings.length) console.log("No violations found. ✔");
    console.log(`Summary: ${errors.length} errors, ${warnings.length} warnings (${findings.length} findings)`);
  }

  process.exit(errors.length ? 1 : 0);
}

main();
