#!/usr/bin/env bun
/**
 * Skill indexer — renders every skill reachable from a project into one
 * browsable markdown file.
 *
 * Two corpora, one renderer:
 *
 *   repo mode     a plugin-source repository. Walks plugins/<p>/skills/**.
 *                 Answers "what does this marketplace ship?" — an authoring
 *                 and review tool.
 *   project mode  an ordinary project. Walks the project's own .claude/skills,
 *                 the personal ~/.claude/skills autodiscovery directory, and
 *                 every installed plugin in the Claude Code cache. Answers
 *                 "what can I actually invoke from here?"
 *
 * Detection is by content, not by name: a directory holding
 * .claude-plugin/marketplace.json, or plugins/<x>/plugin.json, is a plugin
 * source repo. Everything else is a project. --scope overrides.
 *
 * The index reports each skill's listing cost because that number is the
 * scarce resource. Claude Code injects the description of every
 * model-invocable skill into every turn, capped at
 * min(fraction x context x 4, 8000) chars. Over budget, descriptions are
 * dropped least-invoked-first — silently. A skill carrying
 * `disable-model-invocation: true` costs nothing and stays reachable by
 * explicit /invocation, which is why the summary separates the two.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/**
 * The per-turn skill listing budget, as Claude Code 2.1.223 actually computes it:
 *
 *   budget = contextTokens * CHARS_PER_TOKEN * skillListingBudgetFraction
 *
 * verified against the binary — `tBt()`:
 *   function tBt(e,t=JYu){ let r=fV(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET);
 *     if(r) return r; let n=u6_(), o=(e ?? l6_)*t*n; return Math.max(1,Math.floor(o)) }
 *   with JYu=4, a6_=0.01 (the fraction default), l6_=200000 (the context default).
 *
 * There is **no 8,000 hard cap**. 8,000 is simply what the formula yields at the
 * 200,000-token fallback, and the budget scales past it — a 1M-context model
 * gets ~40,000. Treating 8,000 as a ceiling understates the budget by 5x on
 * large-context models and reports drops that do not happen.
 *
 * Two escapes exist and both raise the real budget: the
 * `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var overrides the computation outright, and
 * `skillListingBudgetFraction` in settings raises the fraction. The binary's
 * own over-budget warning names the second one.
 *
 * The default here stays 200,000 because it is the value the binary falls back
 * to, so it is the conservative floor — a corpus that fits at 200k fits
 * everywhere.
 */
const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_TOKENS = 200_000;
const DEFAULT_FRACTION = 0.01;
/** Per-skill description cap — `skillListingMaxDescChars`, default 1536. */
const MAX_DESC_CHARS = 1536;

function listingBudget(contextTokens: number, fraction: number): number {
  return Math.max(1, Math.floor(contextTokens * CHARS_PER_TOKEN * fraction));
}

type Scope = "repo" | "project";

interface Skill {
  /** Absolute path to the SKILL.md. */
  path: string;
  /** Group heading — plugin id, or a pseudo-id for loose skill directories. */
  group: string;
  /** Where the group came from, for the provenance column. */
  origin: string;
  name: string;
  description: string;
  /** Model-invocable — eligible for the per-turn listing. */
  modelInvocable: boolean;
  /** Loaded at all. A cached-but-disabled plugin costs nothing. */
  enabled: boolean;
  /** Offered in the / menu. */
  userInvocable: boolean;
  /** Named by a command or agent in its own plugin, which can preload it. */
  preloaded: boolean;
  /**
   * Finer grouping than the plugin: the `skills/` subdirectory when a plugin
   * uses one as a container, otherwise the plugin itself. `dev` holds 48
   * skills spanning `frontend/` (react, tailwind, tanstack) and `backend/`
   * (golang, rust, python) — one routing line cannot serve both, and the
   * split already exists on disk.
   */
  topic: string;
  argumentHint?: string;
  allowedTools?: string;
  model?: string;
}

// ---------------------------------------------------------------- parsing

/**
 * Minimal YAML frontmatter reader. Handles the flat `key: value` and folded
 * `key: |` shapes skills actually use; anything nested is out of scope and
 * would be a sign the skill is doing something the matcher ignores anyway.
 */
function frontmatter(text: string): Record<string, string> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const buf: Record<string, string[]> = {};
  let key = "";
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (kv) {
      key = kv[1];
      buf[key] = kv[2] === "|" || kv[2] === ">" ? [] : [kv[2]];
    } else if (key && line.trim() && !line.trim().startsWith("-")) {
      buf[key].push(line.trim());
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(buf)) {
    out[k] = v.join(" ").trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "yes";
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || (e.name.startsWith(".") && e.name !== ".claude")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory() || e.isSymbolicLink()) walk(p, out, depth + 1);
    else if (e.name === "SKILL.md") out.push(p);
  }
  return out;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- collection

/**
 * Every word appearing in a plugin's commands/ and agents/ prose.
 *
 * A skill that is neither in the listing nor in the / menu is reachable only
 * when something preloads it by name. Nothing does that implicitly — a
 * manifest entry registers a skill, it does not route to it. So a hidden,
 * unlisted skill named nowhere in its own plugin is unreachable, and that is
 * worth reporting rather than assuming away.
 */
function pluginReferences(pluginRoot: string): string {
  let text = "";
  for (const sub of ["commands", "agents"]) {
    for (const f of walkAll(join(pluginRoot, sub))) {
      try {
        text += readFileSync(f, "utf-8");
      } catch {
        /* unreadable file contributes nothing */
      }
    }
  }
  return text;
}

function walkAll(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkAll(p, out, depth + 1);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * `<group>/<container>` when the skill sits inside a container directory under
 * `skills/`, else `<group>`.
 *
 * A container is a directory under `skills/` that holds no SKILL.md of its own
 * but holds skill directories. `dev/skills/frontend/react-typescript/SKILL.md`
 * is depth 2 and yields `dev/frontend`; `bunjs/skills/errors/SKILL.md` is
 * depth 1 and yields `bunjs`.
 */
function topicOf(path: string, group: string, skillsRoot: string): string {
  if (!skillsRoot) return group;
  const rel = path.startsWith(skillsRoot + sep) ? path.slice(skillsRoot.length + 1) : "";
  const parts = rel.split(sep);
  // parts = [container, skill, "SKILL.md"] for a contained skill.
  return parts.length >= 3 ? `${group}/${parts[0]}` : group;
}

function collect(
  paths: string[],
  group: string,
  origin: string,
  into: Skill[],
  enabled = true,
  references = "",
  skillsRoot = "",
): void {
  for (const path of paths) {
    const fm = frontmatter(readFileSync(path, "utf-8"));
    if (!fm) continue;
    const name = fm.name || basename(dirname(path));
    into.push({
      path,
      group,
      topic: topicOf(path, group, skillsRoot),
      origin,
      enabled,
      preloaded: references.includes(name),
      name,
      description: fm.description ?? "",
      // A skill with no description cannot be matched, so it is not in the
      // listing regardless of what the flag says.
      modelInvocable: !isTrue(fm["disable-model-invocation"]) && Boolean(fm.description),
      userInvocable: !(fm["user-invocable"] === "false"),
      argumentHint: fm["argument-hint"],
      allowedTools: fm["allowed-tools"],
      model: fm.model,
    });
  }
}

function detectScope(root: string): Scope {
  if (existsSync(join(root, ".claude-plugin", "marketplace.json"))) return "repo";
  const pluginsDir = join(root, "plugins");
  try {
    for (const e of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(pluginsDir, e.name, "plugin.json"))) return "repo";
    }
  } catch {
    /* no plugins/ — not a source repo */
  }
  return "project";
}

function collectRepo(root: string): Skill[] {
  const skills: Skill[] = [];
  const pluginsDir = join(root, "plugins");
  let entries: string[] = [];
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    /* fall through to the repo-level skills/ directory */
  }
  for (const name of entries) {
    collect(
      walk(join(pluginsDir, name, "skills")),
      name,
      "plugin source",
      skills,
      true,
      pluginReferences(join(pluginsDir, name)),
      join(pluginsDir, name, "skills"),
    );
  }
  // Repo-level skills/ — project-scoped skills that ship with the repo but
  // belong to no plugin.
  collect(walk(join(root, "skills")), "(repo-level)", "repo skills/", skills);
  return skills;
}

/** Which plugin ids the user or the project has switched on. */
function enabledPlugins(root: string): Set<string> {
  const on = new Set<string>();
  for (const f of [
    join(homedir(), ".claude", "settings.json"),
    join(root, ".claude", "settings.json"),
    join(root, ".claude", "settings.local.json"),
  ]) {
    const s = readJson<{ enabledPlugins?: Record<string, boolean> }>(f);
    for (const [id, v] of Object.entries(s?.enabledPlugins ?? {})) if (v) on.add(id);
  }
  return on;
}

function collectProject(root: string): Skill[] {
  const skills: Skill[] = [];

  collect(walk(join(root, ".claude", "skills")), "(project)", ".claude/skills", skills);

  // ~/.claude/skills/<name>/ is Claude Code's autodiscovery directory: each
  // subdirectory loads as <name>@skills-dir with no install step.
  const personal = join(homedir(), ".claude", "skills");
  try {
    for (const e of readdirSync(personal, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      collect(walk(join(personal, e.name)), `${e.name}@skills-dir`, "autodiscovered", skills);
    }
  } catch {
    /* no personal skills directory */
  }

  // Installed plugins. The registry is authoritative for installPath; the
  // cache tree is the fallback when the registry is missing or stale.
  const on = enabledPlugins(root);
  const seen = new Set<string>();
  const registry = readJson<Record<string, unknown>>(
    join(homedir(), ".claude", "plugins", "installed_plugins.json"),
  );
  for (const [marketplace, plugins] of Object.entries(registry ?? {})) {
    if (typeof plugins !== "object" || plugins === null) continue;
    for (const [name, meta] of Object.entries(plugins as Record<string, unknown>)) {
      const installPath = (meta as { installPath?: string })?.installPath;
      if (!installPath || !existsSync(installPath)) continue;
      const id = `${name}@${marketplace}`;
      seen.add(id);
      collect(
        walk(join(installPath, "skills")),
        id,
        on.has(id) ? "installed, enabled" : "installed, not enabled",
        skills,
        on.has(id),
        pluginReferences(installPath),
        join(installPath, "skills"),
      );
    }
  }
  const cache = join(homedir(), ".claude", "plugins", "cache");
  try {
    for (const mkt of readdirSync(cache, { withFileTypes: true })) {
      if (!mkt.isDirectory()) continue;
      for (const plug of readdirSync(join(cache, mkt.name), { withFileTypes: true })) {
        if (!plug.isDirectory()) continue;
        const id = `${plug.name}@${mkt.name}`;
        if (seen.has(id)) continue;
        // Highest version directory wins — the loader reads one.
        const versions = readdirSync(join(cache, mkt.name, plug.name), { withFileTypes: true })
          .filter((v) => v.isDirectory())
          .map((v) => v.name)
          .sort()
          .reverse();
        if (!versions[0]) continue;
        seen.add(id);
        collect(
          walk(join(cache, mkt.name, plug.name, versions[0], "skills")),
          id,
          on.has(id) ? "cached, enabled" : "cached, not enabled",
          skills,
          on.has(id),
          pluginReferences(join(cache, mkt.name, plug.name, versions[0])),
          join(cache, mkt.name, plug.name, versions[0], "skills"),
        );
      }
    }
  } catch {
    /* no plugin cache on this machine */
  }
  return skills;
}

// -------------------------------------------------------------- rendering

/**
 * The string you actually type. Pseudo-groups are bracketed — `(project)`,
 * `(repo-level)` — because those skills belong to no plugin and are invoked
 * bare. Prefixing them would emit `/(repo-level):release`, which resolves to
 * nothing.
 */
function invokeName(s: Skill): string {
  return s.group.startsWith("(") ? s.name : `${s.group.split("@")[0]}:${s.name}`;
}

function invocation(s: Skill): string {
  const bare = invokeName(s);
  return s.userInvocable ? `\`/${bare}\`` : `\`${bare}\` (not in / menu)`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Only an enabled, model-invocable skill with a description is in the listing. */
function inListing(s: Skill): boolean {
  return s.enabled && s.modelInvocable;
}

/**
 * How a skill can actually be found, worst case first.
 *
 * The tempting rule is "a model-invocable skill advertises itself, so the
 * index need not name it". That holds only while the listing fits its budget,
 * and whether it does depends on the model: 13,022 chars overflows the 8,000
 * a 200k-token window allows, and fits the 40,000 a 1M window allows. Same
 * corpus, different outcome, and a shipped plugin does not choose the model.
 *
 * A `listed` skill carrying `user-invocable: false` is the one that suffers:
 * when its description is shortened the matcher cannot match on what was cut,
 * and nobody can type it either. It has no fallback at all.
 *
 * A CLAUDE.md block reads the same on every model. That is the argument for
 * it — portability, not overflow.
 */
type Reach = "unreachable" | "listed" | "slash" | "preloaded";

function reach(s: Skill): Reach {
  if (s.modelInvocable) return "listed"; // in the listing — but only while it fits
  if (s.userInvocable) return "slash"; // typed explicitly; matcher cannot see it
  if (s.preloaded) return "preloaded"; // an agent or command names it
  return "unreachable"; // nothing can get to it
}

/** Everything the model cannot reliably discover on its own. */
function atRisk(s: Skill): boolean {
  return s.enabled && reach(s) !== "preloaded";
}

function render(
  skills: Skill[],
  scope: Scope,
  root: string,
  contextTokens: number,
  fraction: number,
): string {
  const listed = skills.filter(inListing);
  const cost = listed.reduce((n, s) => n + s.description.length, 0);
  const dormant = skills.filter((s) => !s.enabled).length;
  const groups = new Map<string, Skill[]>();
  for (const s of skills) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }
  const ranked = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  const out: string[] = [];
  out.push("# Skill index", "");
  out.push(
    `Generated by \`/setup:index-skills\` in **${scope}** scope. Regenerate rather than hand-edit — the next run overwrites this file.`,
    "",
  );

  out.push("## Summary", "");
  out.push("| | |", "|---|---|");
  out.push(`| Skills found | ${skills.length} |`);
  out.push(`| Groups | ${ranked.length} |`);
  out.push(`| In the per-turn listing | ${listed.length} |`);
  out.push(
    `| Explicit-invocation only | ${skills.filter((s) => s.enabled && !s.modelInvocable).length} |`,
  );
  if (dormant) out.push(`| Present but not enabled (costs nothing) | ${dormant} |`);
  const budget = listingBudget(contextTokens, fraction);
  out.push(
    `| Listing cost | ${cost} chars vs ${budget} budget ${cost > budget ? `— **over by ${cost - budget}**` : "— fits"} |`,
  );
  out.push(
    `| Budget basis | ${contextTokens.toLocaleString()} ctx tokens x ${CHARS_PER_TOKEN} x ${fraction} |`,
  );
  const oversize = listed.filter((s) => s.description.length > MAX_DESC_CHARS);
  if (oversize.length) {
    out.push(`| Over the ${MAX_DESC_CHARS}-char per-skill cap | ${oversize.length} |`);
  }
  out.push("");
  if (cost > budget) {
    const fit = Math.max(0, Math.round((budget / cost) * listed.length));
    out.push(
      `> Over budget **at ${contextTokens.toLocaleString()}-token context**. Claude Code then switches the ` +
        `listing from \`fits\` to \`priority\` mode and shortens descriptions to fit; roughly **${fit} of ` +
        `${listed.length}** keep theirs. The budget is \`context x ${CHARS_PER_TOKEN} x ${fraction}\` and ` +
        `scales with the window — a 1M-context model gets ${listingBudget(1_000_000, fraction).toLocaleString()}, ` +
        `where this corpus would fit. Re-run with \`--context 1000000\` for that model's number. ` +
        `To fix it rather than measure it: set \`disable-model-invocation: true\` on skills reached by ` +
        `explicit \`/invocation\`, or raise \`skillListingBudgetFraction\` in settings.`,
      "",
    );
  }

  out.push("## Listing cost by group", "");
  out.push("| Group | Skills | Listed | Chars |", "|---|---:|---:|---:|");
  for (const [group, items] of [...ranked].sort(
    (a, b) => groupCost(b[1]) - groupCost(a[1]) || a[0].localeCompare(b[0]),
  )) {
    const l = items.filter(inListing);
    out.push(`| ${group} | ${items.length} | ${l.length} | ${groupCost(items)} |`);
  }
  out.push("");

  out.push("## Skills", "");
  for (const [group, items] of ranked) {
    out.push(`### ${group}`, "");
    out.push(`*${items[0].origin}* — ${items.length} skill${items.length === 1 ? "" : "s"}`, "");
    out.push("| Invoke | Description | Listing | Chars |", "|---|---|---|---:|");
    for (const s of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const desc = s.description ? escapeCell(s.description) : "*(no description — cannot be matched)*";
      const listing = !s.enabled ? "not enabled" : s.modelInvocable ? "auto" : "explicit";
      out.push(
        `| ${invocation(s)} | ${desc} | ${listing} | ${inListing(s) ? s.description.length : 0} |`,
      );
    }
    out.push("");
    for (const s of items) {
      const rel = s.path.startsWith(root + sep) ? relative(root, s.path) : s.path;
      out.push(`- \`${s.name}\` → \`${rel}\``);
    }
    out.push("");
  }
  return out.join("\n");
}

function groupCost(items: Skill[]): number {
  return items.filter(inListing).reduce((n, s) => n + s.description.length, 0);
}

// ------------------------------------------------------- compact CLAUDE.md

const BEGIN = "<!-- skill-index:begin -->";
const END = "<!-- skill-index:end -->";

/**
 * The small index — sized for CLAUDE.md, which is injected on every turn.
 *
 * Names, not descriptions. That is the whole trade: 3,142 chars of invocation
 * strings covers every skill deterministically, where 13,022 chars of listing
 * covers about 47 of 77 and picks which ones by a rule nothing on disk can
 * predict. A name is a weaker signal than a description, but a name that is
 * always present beats a description that vanishes.
 *
 * Skills reached only by preloading are omitted by default: the command or
 * agent that preloads them already names them at the point of use, so a
 * routing line would be a second copy of a pointer that already works.
 * `--all` includes them.
 */
function renderCompact(
  skills: Skill[],
  scope: Scope,
  maxPerPlugin: number,
  opts: { slashOnly: boolean; all: boolean; contextTokens: number; fraction: number },
): string {
  const include = (s: Skill) => {
    if (!s.enabled) return false;
    if (opts.slashOnly) return reach(s) === "slash";
    if (opts.all) return true;
    return atRisk(s);
  };

  const groups = new Map<string, Skill[]>();
  for (const s of skills.filter(include)) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }

  const listed = skills.filter(inListing);
  const cost = listed.reduce((n, s) => n + s.description.length, 0);
  const budget = listingBudget(opts.contextTokens, opts.fraction);
  const overflow = cost > budget;
  const fits = overflow ? Math.round((budget / cost) * listed.length) : listed.length;

  // Marks only the reaches that need one. `listed` is the common case and
  // carries no glyph — marking everything is the same as marking nothing.
  const MARK: Record<Reach, string> = {
    listed: "",
    slash: "*",
    preloaded: "^",
    unreachable: "!",
  };

  const rows: string[] = [];
  let truncated = 0;
  for (const [group, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = items.sort((a, b) => a.name.localeCompare(b.name));
    const shown = maxPerPlugin > 0 ? sorted.slice(0, maxPerPlugin) : sorted;
    truncated += sorted.length - shown.length;
    const names = shown.map((s) => `\`/${invokeName(s)}\`${MARK[reach(s)]}`).join(" ");
    const tail = sorted.length > shown.length ? ` +${sorted.length - shown.length} more` : "";
    rows.push(`| ${group} | ${names}${tail} |`);
  }

  const broken = skills.filter((s) => s.enabled && reach(s) === "unreachable");
  const enabled = skills.filter((s) => s.enabled).length;

  const out = [
    BEGIN,
    "<!-- generated by /setup:index-skills — do not hand-edit, the next run overwrites it -->",
    "## Skill index",
    "",
    `${enabled} skills, ${rows.length} plugins (${scope} scope). Invoke any of them by name.`,
    "",
    overflow
      ? `The per-turn skill listing runs **${cost} chars against a ${budget} budget** at ` +
        `${opts.contextTokens.toLocaleString()}-token context, so only about **${fits} of ` +
        `${listed.length}** descriptions survive a turn. This index does not shorten. When a skill ` +
        `below looks relevant, invoke it by name rather than waiting to match on a description that ` +
        `may not be present.`
      : `The per-turn skill listing fits its budget (${cost}/${budget} at ` +
        `${opts.contextTokens.toLocaleString()}-token context), so descriptions are intact there. ` +
        `This index is the deterministic backstop: it is identical on every model, where the ` +
        `listing budget scales with the context window and shortens descriptions on smaller ones.`,
    "",
    `Marks: unmarked = description in the listing when it fits · \`*\` = explicit invocation only, ` +
      `never in the listing · \`^\` = preloaded by its own command or agent · \`!\` = **unreachable**, ` +
      `nothing can invoke it.`,
    "",
    "| Plugin | Skills |",
    "|---|---|",
    ...rows,
  ];

  if (truncated > 0) {
    out.push(
      "",
      `> ${truncated} skills omitted by \`--max-per-plugin\`. Full list: \`SKILLS.md\`.`,
    );
  }
  if (broken.length) {
    out.push(
      "",
      `> **${broken.length} unreachable**: ${broken.map((s) => `\`${invokeName(s)}\``).join(", ")}. ` +
        `Each carries \`disable-model-invocation\` and \`user-invocable: false\` while no command or ` +
        `agent names it, so no path reaches it. Fix by adding the skill to a command's \`skills:\` ` +
        `frontmatter, or by dropping one of the two flags.`,
    );
  }
  out.push("", `Descriptions and paths: \`SKILLS.md\`.`, END);
  return out.join("\n");
}

// ------------------------------------------------------- tiered (2 levels)

/**
 * Level 1 lives in CLAUDE.md and names topics, not invocations. Level 2 is one
 * file per topic group carrying the invocation strings and descriptions.
 *
 * The compression is real and not just a shuffle. bunjs as invocation strings
 * costs ~200 chars of `\`/bunjs:errors\` \`/bunjs:http-service\` ...`; as a topic
 * phrase it costs ~85 and reads as prose, which is a *better* routing trigger
 * than punctuation. Invocation syntax is only needed at the moment of invoking,
 * and that is exactly when level 2 gets read.
 *
 * The trade is honest: level 1 alone cannot invoke anything. It buys depth
 * (full descriptions at level 2) at the price of a Read the agent must actually
 * perform. A skipped Read is a real failure mode — but a deterministic and
 * instructable one, unlike the listing silently shortening a description.
 *
 * Groups below `threshold` skip level 2 entirely and name their skills inline.
 * For a one-skill plugin the pointer costs more than the name it replaces.
 */
function humanize(name: string): string {
  return name.replace(/-/g, " ");
}

function groupByTopic(skills: Skill[]): Map<string, Skill[]> {
  const m = new Map<string, Skill[]>();
  for (const s of skills) {
    if (!m.has(s.topic)) m.set(s.topic, []);
    m.get(s.topic)!.push(s);
  }
  for (const items of m.values()) items.sort((a, b) => a.name.localeCompare(b.name));
  return m;
}

/** Filename for a topic group's level-2 file. `dev/frontend` -> `dev-frontend.md`. */
function topicFile(topic: string): string {
  return `${topic.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}.md`;
}

/**
 * A skill's location, never as an absolute machine path.
 *
 * Absolute paths in a generated file are wrong twice over: they are meaningless in any
 * other checkout, and they are a bypass. The IDX-1 bench caught the second — a tiered
 * index listing `/Users/…/skills/errors/SKILL.md` let the agent open the skill file
 * directly instead of invoking the skill, so the index worked and the run scored zero.
 * 107 such paths were being emitted per full run.
 *
 * Inside the root we emit a repo-relative path. Outside it (an installed plugin in the
 * cache) we emit nothing but the invocation, because a `../../../..` chain into someone
 * else's home directory helps no one.
 */
function skillLocation(s: Skill, root: string): string {
  if (!s.path.startsWith(root + sep)) return "";
  return relative(root, s.path);
}

function renderTierTwo(topic: string, items: Skill[], scope: Scope, root: string): string {
  const out = [
    `# ${topic}`,
    "",
    `${items.length} skill${items.length === 1 ? "" : "s"} (${scope} scope). Generated by ` +
      `\`/setup:index-skills --tiered\` — regenerate rather than hand-edit.`,
    "",
    "| Invoke | Does | Reach |",
    "|---|---|---|",
  ];
  for (const s of items) {
    const desc = s.description ? escapeCell(s.description) : "*(no description)*";
    out.push(`| \`/${invokeName(s)}\` | ${desc} | ${reach(s)} |`);
  }
  out.push("");
  for (const s of items) {
    const loc = skillLocation(s, root);
    out.push(loc ? `- \`${s.name}\` → \`${loc}\`` : `- \`${s.name}\``);
  }
  out.push("");
  return out.join("\n");
}

/**
 * How many skill names a level-1 row may list before it stops enumerating.
 *
 * This number is what makes or breaks the tier. Enumerating every skill costs
 * almost exactly what the invocation strings cost — measured at 3,986 vs 4,455
 * chars on this repo, a 10% saving that does not justify the extra Read. The
 * saving comes from *not* listing, so the row must read as a topic, with the
 * full set one level down.
 */
function coversPhrase(items: Skill[], topicMax: number): string {
  const names = items.map((s) => humanize(s.name));
  if (topicMax <= 0 || names.length <= topicMax) return names.join(", ");
  return `${names.slice(0, topicMax).join(", ")}, +${names.length - topicMax} more`;
}

function renderTierOne(
  skills: Skill[],
  scope: Scope,
  threshold: number,
  indexDir: string,
  topicMax: number,
  root: string,
): { block: string; files: Map<string, string> } {
  const groups = groupByTopic(skills.filter((s) => s.enabled && reach(s) !== "preloaded"));
  const ranked = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const files = new Map<string, string>();

  const deep: string[] = [];
  const inline: string[] = [];
  for (const [topic, items] of ranked) {
    if (items.length >= threshold) {
      const file = topicFile(topic);
      files.set(file, renderTierTwo(topic, items, scope, root));
      const topics = coversPhrase(items, topicMax);
      deep.push(`| **${topic}** | ${items.length} | ${topics} | \`${indexDir}/${file}\` |`);
    } else {
      inline.push(`| **${topic}** | ${items.map((s) => `\`/${invokeName(s)}\``).join(" ")} |`);
    }
  }

  const broken = skills.filter((s) => s.enabled && reach(s) === "unreachable");
  const out = [
    BEGIN,
    "<!-- generated by /setup:index-skills --tiered — do not hand-edit, the next run overwrites it -->",
    "## Skill index",
    "",
    `Two levels. This table names **what each group covers**; it carries no invocation ` +
      `strings, so it cannot be acted on directly. **Before doing work in one of these areas, ` +
      `read that group's file** — it holds the exact \`/plugin:skill\` names and what each does.`,
    "",
    "| Group | Skills | Covers | Read this first |",
    "|---|---:|---|---|",
    ...deep,
  ];
  if (inline.length) {
    out.push(
      "",
      `Small groups, named inline — no file to read:`,
      "",
      "| Group | Invoke |",
      "|---|---|",
      ...inline,
    );
  }
  if (broken.length) {
    out.push(
      "",
      `> **${broken.length} unreachable**: ${broken.map((s) => `\`${invokeName(s)}\``).join(", ")}. ` +
        `Each carries \`disable-model-invocation\` and \`user-invocable: false\` while no command or ` +
        `agent names it, so no path reaches it.`,
    );
  }
  out.push("", `Everything, with descriptions and paths: \`SKILLS.md\`.`, END);
  return { block: out.join("\n"), files };
}

/**
 * Replace the managed block in place, or append it.
 *
 * The markers exist so this is idempotent. Without an addressable region the
 * second run appends, and the file ends up with two indexes that disagree the
 * moment a skill is added — with nothing to say which is current.
 */
function spliceBlock(existing: string, block: string): { text: string; action: string } {
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start !== -1 && end !== -1 && end > start) {
    return {
      text: existing.slice(0, start) + block + existing.slice(end + END.length),
      action: "replaced",
    };
  }
  if (start !== -1 || end !== -1) {
    throw new Error(
      "CLAUDE.md has one skill-index marker but not the other — refusing to write. " +
        "Repair the markers by hand; guessing where the block ends could delete real content.",
    );
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return { text: existing + sep + block + "\n", action: "appended" };
}

// ------------------------------------------------------------------- main

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = resolve(arg("--root") ?? process.cwd());
const requested = arg("--scope");
if (requested && requested !== "repo" && requested !== "project" && requested !== "auto") {
  console.error(`error: --scope must be repo, project, or auto (got "${requested}")`);
  process.exit(1);
}
const scope: Scope = requested && requested !== "auto" ? (requested as Scope) : detectScope(root);

const skills = scope === "repo" ? collectRepo(root) : collectProject(root);
if (skills.length === 0) {
  console.error(
    `error: no SKILL.md found under ${root} in ${scope} scope. Try --scope ${scope === "repo" ? "project" : "repo"}.`,
  );
  process.exit(1);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scope, root, skills }, null, 2));
  process.exit(0);
}

const maxPerPlugin = Number(arg("--max-per-plugin") ?? 0);
if (!Number.isFinite(maxPerPlugin) || maxPerPlugin < 0) {
  console.error("error: --max-per-plugin must be a non-negative number (0 = no cap)");
  process.exit(1);
}

const contextTokens = Number(arg("--context") ?? DEFAULT_CONTEXT_TOKENS);
if (!Number.isFinite(contextTokens) || contextTokens <= 0) {
  console.error("error: --context must be a positive number of tokens (e.g. 200000, 1000000)");
  process.exit(1);
}
const fraction = Number(arg("--fraction") ?? DEFAULT_FRACTION);
if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
  console.error("error: --fraction must be greater than 0 and at most 1 (default 0.01)");
  process.exit(1);
}

const listed = skills.filter(inListing);
const cost = listed.reduce((n, s) => n + s.description.length, 0);
const budget = listingBudget(contextTokens, fraction);
const costLine =
  `${cost}/${budget} listing chars at ${contextTokens.toLocaleString()}-token context` +
  (cost > budget ? ` (OVER by ${cost - budget})` : " (fits)");

const compactOpts = {
  slashOnly: process.argv.includes("--slash-only"),
  all: process.argv.includes("--all"),
  contextTokens,
  fraction,
};
if (compactOpts.slashOnly && compactOpts.all) {
  console.error("error: --slash-only and --all are mutually exclusive");
  process.exit(1);
}
const unreachable = skills.filter((s) => s.enabled && reach(s) === "unreachable");

const tiered = process.argv.includes("--tiered");
const threshold = Number(arg("--threshold") ?? 4);
if (!Number.isFinite(threshold) || threshold < 1) {
  console.error("error: --threshold must be at least 1 (groups smaller than it are named inline)");
  process.exit(1);
}
const indexDir = arg("--index-dir") ?? ".claude/skill-index";
const topicMax = Number(arg("--topic-max") ?? 5);
if (!Number.isFinite(topicMax) || topicMax < 0) {
  console.error("error: --topic-max must be a non-negative number (0 = list every skill)");
  process.exit(1);
}

// --claude-md: splice the block into CLAUDE.md. Takes an optional path so a
// project with a non-standard location can still be targeted.
const claudeMdFlag = process.argv.indexOf("--claude-md");
if (claudeMdFlag !== -1) {
  const next = process.argv[claudeMdFlag + 1];
  const target = resolve(next && !next.startsWith("--") ? next : join(root, "CLAUDE.md"));

  if (tiered) {
    // The pointer is relativized against CLAUDE.md's own directory, not --root.
    // A reader follows it from where the file sits, and those two are the same
    // directory in the normal case but not when --root points at a plugin tree
    // being indexed *into* a different project — which is exactly what the
    // skill-index bench does when it stages a workspace.
    const dirAbs = resolve(root, indexDir);
    const dirRel = relative(dirname(target), dirAbs) || indexDir;
    const { block, files } = renderTierOne(skills, scope, threshold, dirRel, topicMax, root);
    if (process.argv.includes("--stdout")) {
      console.log(block);
      for (const [name, body] of files) console.log(`\n===== ${indexDir}/${name} =====\n${body}`);
      process.exit(0);
    }
    const existing = existsSync(target) ? readFileSync(target, "utf-8") : "";
    let result;
    try {
      result = spliceBlock(existing, block);
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      process.exit(1);
    }
    mkdirSync(dirAbs, { recursive: true });
    let level2 = 0;
    for (const [name, body] of files) {
      writeFileSync(join(dirAbs, name), body);
      level2 += body.length;
    }
    writeFileSync(target, result.text);
    console.log(
      `${result.action} the tiered skill-index block in ${relative(root, target) || target} — ` +
        `${block.length} chars loaded every turn, plus ${files.size} group files ` +
        `(${level2} chars) in ${dirRel}/ read on demand; ${costLine}.`,
    );
    if (unreachable.length) {
      console.log(
        `WARNING: ${unreachable.length} unreachable skill(s): ` +
          unreachable.map((s) => invokeName(s)).join(", "),
      );
    }
    process.exit(0);
  }

  const block = renderCompact(skills, scope, maxPerPlugin, compactOpts);

  if (process.argv.includes("--stdout")) {
    console.log(block);
    process.exit(0);
  }

  const existing = existsSync(target) ? readFileSync(target, "utf-8") : "";
  let result;
  try {
    result = spliceBlock(existing, block);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
  writeFileSync(target, result.text);
  console.log(
    `${result.action} the skill-index block in ${relative(root, target) || target} — ` +
      `${block.length} chars, loaded every turn; ${costLine}.`,
  );
  if (unreachable.length) {
    console.log(
      `WARNING: ${unreachable.length} unreachable skill(s): ` +
        unreachable.map((s) => `${s.group.split("@")[0]}:${s.name}`).join(", "),
    );
  }
  process.exit(0);
}

if (process.argv.includes("--compact")) {
  const block = renderCompact(skills, scope, maxPerPlugin, compactOpts);
  if (process.argv.includes("--stdout")) {
    console.log(block);
  } else {
    const target = resolve(arg("--out") ?? join(root, "SKILLS-INDEX.md"));
    writeFileSync(target, block + "\n");
    console.log(`wrote ${relative(root, target) || target} — ${block.length} chars, ${costLine}`);
  }
  process.exit(0);
}

const out = resolve(arg("--out") ?? join(root, "SKILLS.md"));
const markdown = render(skills, scope, root, contextTokens, fraction);
if (process.argv.includes("--stdout")) {
  console.log(markdown);
} else {
  writeFileSync(out, markdown);
  console.log(
    `wrote ${relative(root, out) || out} — ${skills.length} skills, ${scope} scope, ${costLine}`,
  );
}
