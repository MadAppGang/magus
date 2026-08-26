#!/usr/bin/env bun
/**
 * check-skill.ts — mechanical validation for a single SKILL.md.
 *
 *   bun skills/skill-authoring/scripts/check-skill.ts <skill-dir-or-SKILL.md>
 *   bun skills/skill-authoring/scripts/check-skill.ts plugins/dev/skills/core/universal-patterns
 *
 * Checks only what a machine can decide. Whether a description actually TRIGGERS is a
 * measurement, not a lint — see references/routing-eval.md. This script exists so that
 * the judgement calls are the only thing left to argue about.
 *
 * Exit 0 clean or warnings only; exit 1 if any error.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const MAX_DESC = 250; // this repo's ceiling, enforced in CI by scripts/skill-budget-check.ts
const PORTABLE_DESC = 1024; // Agent Skills open standard
const MAX_NAME = 64;
const MAX_BODY_LINES = 500;

// Everything else in frontmatter is silently ignored by the matcher.
const KNOWN_KEYS = new Set([
  "name", "description", "when_to_use", "argument-hint", "arguments",
  "disable-model-invocation", "user-invocable", "allowed-tools", "model",
  "effort", "context", "agent", "hooks", "paths", "shell",
]);

// Keys authors reach for that do nothing at all.
const DEAD_KEYS = new Set(["triggers", "tags", "keywords", "category", "version", "author"]);

const VAGUE = [
  /^helps? with\b/i, /^processes?\b.*\bdata\b/i, /^does stuff\b/i,
  /^comprehensive\b/i, /^complete\b/i, /^powerful\b/i, /^robust\b/i, /^advanced\b/i,
];

const errors: string[] = [];
const warnings: string[] = [];

const arg = process.argv[2];
if (!arg) {
  console.error("usage: check-skill.ts <skill-dir-or-SKILL.md>");
  process.exit(1);
}
const file = arg.endsWith("SKILL.md") ? arg : join(arg, "SKILL.md");
if (!existsSync(file)) {
  console.error(`no SKILL.md at ${file}`);
  process.exit(1);
}
const dir = file.replace(/\/SKILL\.md$/, "");
const src = readFileSync(file, "utf8");

// ---- frontmatter -----------------------------------------------------------
const fm = src.match(/^---\n([\s\S]*?)\n---/);
if (!fm) {
  console.error(`${file}: no frontmatter`);
  process.exit(1);
}
const body = src.slice(fm[0].length);

// Parse top-level keys only; a block scalar's continuation lines are indented.
const fields: Record<string, string> = {};
let key = "";
for (const line of fm[1].split("\n")) {
  const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
  if (kv) {
    key = kv[1];
    fields[key] = kv[2];
  } else if (key && line.trim()) {
    fields[key] = `${fields[key]} ${line.trim()}`.trim();
  }
}

for (const k of Object.keys(fields)) {
  if (DEAD_KEYS.has(k)) errors.push(`frontmatter key "${k}" is silently ignored — it does nothing`);
  else if (!KNOWN_KEYS.has(k)) warnings.push(`frontmatter key "${k}" is not a recognized key`);
}

// ---- name ------------------------------------------------------------------
const name = fields.name?.replace(/^["']|["']$/g, "");
if (!name) errors.push("no name");
else {
  if (name.length > MAX_NAME) errors.push(`name is ${name.length} chars, over ${MAX_NAME}`);
  if (!/^[a-z0-9-]+$/.test(name)) errors.push(`name "${name}" must be lowercase, digits and hyphens only`);
  if (/claude|anthropic/i.test(name)) errors.push(`name "${name}" uses a reserved word`);
  if (name !== basename(dir)) warnings.push(`name "${name}" does not match its folder "${basename(dir)}"`);
}

// ---- description -----------------------------------------------------------
const desc = fields.description?.replace(/^["']|["']$/g, "").replace(/^[|>][-+]?\s*/, "").trim();
const hidden = fields["disable-model-invocation"] === "true";

if (!desc) {
  errors.push("no description — the skill can never be model-invoked");
} else {
  if (desc.length > PORTABLE_DESC) errors.push(`description ${desc.length} chars, over the portable ${PORTABLE_DESC} limit`);
  else if (desc.length > MAX_DESC) errors.push(`description ${desc.length} chars, over this repo's ${MAX_DESC} ceiling`);

  if (/[<>]/.test(desc)) errors.push("description contains < or > — fails validation");
  if (/\b(I |I'll|you can use|we )/i.test(desc)) errors.push("description is not third person");
  for (const p of VAGUE) if (p.test(desc)) warnings.push(`description opens vaguely: "${desc.slice(0, 40)}…"`);
  if (/^use when/i.test(desc)) warnings.push("description leads with the trigger — lead with the capability, it survives truncation");
  if (/\b(step 1|first,|then,)\b/i.test(desc)) warnings.push("description looks like workflow steps — those get followed instead of the body");
  if (/(trigger keywords?|keywords?)\s*[-:]/i.test(desc)) warnings.push("trailing keyword list adds cost without adding triggers");
  if (!hidden && !/\buse (when|for|before|while)\b/i.test(desc)) warnings.push("no 'Use when …' clause — the model has nothing to match against");
}

// A hidden skill still pays nothing, but a listed one that nothing routes to is a trap.
//
// Find the plugin root by walking up to the directory holding the manifest — either
// plugin.json or .claude-plugin/plugin.json — rather than assuming a fixed depth.
// Skills live at BOTH depths in this repo — grouped
// (dev/skills/backend/api-design/) and flat (terminal/skills/workspace-setup/) — so a
// hardcoded "../../.." resolves to plugins/ for every flat skill, finds no agents/ or
// commands/ directory, and reports each one unreachable regardless of what references it.
function pluginRoot(from: string): string | null {
  let cur = resolve(from);
  for (let i = 0; i < 6; i++) {
    // Both manifest locations. Every plugin here moved to .claude-plugin/plugin.json,
    // so checking only the root location returns null for all of them — which turns
    // the reachability error below into a warning that can never fire.
    if (existsSync(join(cur, "plugin.json"))) return cur;
    if (existsSync(join(cur, ".claude-plugin", "plugin.json"))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

if (hidden && fields["user-invocable"] === "false") {
  const root = pluginRoot(dir);
  // Sibling skills route to hidden skills too — the entry-point skill naming a file to
  // read is a legitimate route, not just agents and commands.
  const refs = root
    ? ["agents", "commands", "skills"].flatMap((sub) => {
        const p = join(root, sub);
        if (!existsSync(p)) return [];
        try {
          return readdirSync(p, { recursive: true, encoding: "utf8" })
            .filter((f) => f.endsWith(".md") && !f.includes(`${name}/`))
            .map((f) => {
              try {
                return readFileSync(join(p, f), "utf8");
              } catch {
                return "";
              }
            });
        } catch {
          return [];
        }
      })
    : [];
  if (!root) {
    warnings.push("could not locate the plugin root — reachability not checked");
  } else if (name && !refs.some((t) => t.includes(name))) {
    errors.push(`hidden AND user-invocable:false AND nothing references "${name}" — unreachable`);
  }
}

// ---- body ------------------------------------------------------------------
const lines = body.split("\n").length;
if (lines > MAX_BODY_LINES) {
  warnings.push(`body is ${lines} lines, over ${MAX_BODY_LINES} — split conditional depth into references/`);
}

// ---- references ------------------------------------------------------------
const refDir = join(dir, "references");
if (existsSync(refDir) && statSync(refDir).isDirectory()) {
  for (const f of readdirSync(refDir)) {
    if (!f.endsWith(".md")) continue;
    if (!body.includes(f)) {
      warnings.push(`references/${f} is never named in the body — nothing will open it`);
    }
    const rsrc = readFileSync(join(refDir, f), "utf8");
    if (/^---\n[\s\S]*?\nname:/m.test(rsrc)) {
      warnings.push(`references/${f} still carries skill frontmatter — it is a reference, not a skill`);
    }
  }
}

for (const junk of ["README.md", "CHANGELOG.md", "QUICK_REFERENCE.md", "INSTALLATION_GUIDE.md"]) {
  if (existsSync(join(dir, junk))) warnings.push(`${junk} does not belong inside a skill`);
}

// ---- report ----------------------------------------------------------------
const C = { red: "\x1b[0;31m", yellow: "\x1b[1;33m", green: "\x1b[0;32m", off: "\x1b[0m" };
console.log(`\n${file}`);
console.log(`  name         ${name ?? "(none)"}`);
console.log(`  description  ${desc ? `${desc.length} chars` : "(none)"} (ceiling ${MAX_DESC})`);
console.log(`  visibility   ${hidden ? "hidden — costs no budget" : "listed — costs budget every turn"}`);
console.log(`  body         ${lines} lines`);

for (const e of errors) console.log(`  ${C.red}ERROR${C.off}  ${e}`);
for (const w of warnings) console.log(`  ${C.yellow}warn${C.off}   ${w}`);

if (errors.length) {
  console.log(`\n${C.red}FAIL${C.off}: ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(1);
}
console.log(`\n${C.green}PASS${C.off}${warnings.length ? ` with ${warnings.length} warning(s)` : ""}\n`);
