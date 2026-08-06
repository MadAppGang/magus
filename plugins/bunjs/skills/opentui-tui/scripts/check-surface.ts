#!/usr/bin/env bun
/**
 * check-surface.ts — lint this skill for MIXED-SURFACE snippets: the core construct DSL
 * (`Box({…})`, `Box(opts)`, `new XRenderable(…)`) in the same file or fenced block as a React
 * intrinsic (`<box>`, `<text>`, `<scrollbox>`). Such code compiles under neither surface. An
 * "@opentui/core" IMPORT is never a violation: the rule keys on a construct CALL beside JSX.
 *
 * RULE 4 PARSES; IT DOES NOT PATTERN-MATCH. A regex lost this fight four separate times — a
 * comment between callee and paren, a parenthesized callee, a namespace call, a local alias —
 * and each patch widened a pattern that the next ordinary piece of syntax walked straight around.
 * TypeScript is already a devDependency, so rule 4 runs on its AST: syntax is the parser's problem,
 * and SCOPE becomes available. A name is the construct only when it traces to "@opentui/core" or is
 * free, so a user's own `function Box(){}` stays theirs even when called — the case the old
 * declaration-blanking hack could not express. Comments and string literals are not code, so a doc
 * may name the banned form in order to ban it. Rules 1/2/3/5 stay textual: they are SPELLINGS, and
 * a wrong spelling in prose is still wrong.
 *
 * Markdown is unwrapped to units first: ``` and ~~~ fences of any length and indent, an info string
 * with attributes (```tsx title=demo), blockquoted fences at any nesting, an unterminated fence (it
 * runs to EOF, per CommonMark), plus unlabelled fences and 4-space indented blocks — those two only
 * when they parse cleanly, so prose can never invent a violation. Line endings are normalised first:
 * a CRLF markdown file matched no fence at all and reported nothing, which is a whole-file bypass.
 * PROSE ITSELF IS NEVER CODE, which is what keeps the mandated surface banner quiet: it quotes
 * `Text({…})` in order to forbid it.
 *
 * Exemptions are POSITIONAL wherever they can be. Only a file that is core-surface end to end is
 * allowlisted by path (`ALLOW_MIX`); a file that merely TURNS core half way down marks the turn with
 * the GATE string, and only what follows the marker is exempt — no marker, no exemption, so removing
 * or renaming it fails loudly instead of switching the file off. The "0 blocks" alarm is scoped the
 * same way: it fires per FILE that opened a ts/tsx fence and produced nothing, judged by a probe of
 * the raw text that shares no code with the extractor, so a consumer app whose README has no
 * TypeScript in it — the tree SKILL.md tells people to run this in — stays silent.
 *
 * WHAT IT DOES NOT CATCH, on purpose — one fixture each, printed as `GAP` by every --self-test run:
 * a namespace returned through a function (`getCore().Box({…})`: no interprocedural dataflow), a
 * construct re-exported by the user's own module (no cross-file resolution — the same rule that lets
 * a project have its own `Box`), and code inside a string handed to `eval` (the price of letting a
 * doc name what it forbids). Adding a shape-specific patch for any of these would read like the
 * class was handled.
 *
 * Usage: bun scripts/check-surface.ts [ROOT] · --self-test (fixtures) · --blocks [ROOT] (dump units)
 * Exit:  0 clean · 1 violations · 2 nothing scanned (a wrong ROOT must not look like a pass).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// MEASURED 2026-07-30, same in 0.1.107 and 0.4.5 — constructs.d.ts. There is NO `Group`.
const CONSTRUCTS = ["Generic", "Box", "Text", "ASCIIFont", "Input", "Select", "TabSelect", "FrameBuffer", "Code", "ScrollBox"];
// Host intrinsics — react/src/components/index.d.ts `baseComponents`, all 20 keys.
const INTRINSICS = ["ascii-font", "tab-select", "line-number", "scrollbox", "textarea", "markdown", "strong", "select", "input", "span", "text", "code", "diff", "box", "br", "em", "a", "b", "i", "u"];
const ALLOW_ALL = ["scripts/check-surface.ts"];
// WHOLE-FILE exemption from rule 4, and the bar is high: core-api.md is core-surface top to bottom
// and its job is to put a construct call beside its React equivalent in one table. A file that is
// only PARTLY core does NOT belong here — it marks the turn with the GATE below, which exempts what
// comes after it and checks what comes before. `components-and-charts.md` used to sit in this list
// and so was unchecked above its own gate; positional beats path, and a missing marker fails closed.
const ALLOW_MIX = ["references/core-api.md"];
const GATE = "You are leaving the React surface"; // where a split file turns core-surface
const SKIP = new Set(["node_modules", "dist", "fixtures"]);
const SCAN = /\.(?:[cm]?tsx?|[cm]?jsx?|mdx?)$/;
const CORE_MOD = /^@opentui\/core(?:\/|$)/;
const CODE_LANG = new Set(["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs", "typescript", "javascript", "typescriptreact", "javascriptreact"]);
const TS_LANG = new Set(["ts", "mts", "cts", "typescript"]); // everything else parses as TSX first
const THUNK = new Set(["call", "apply", "bind"]); // Box.call(null, opts) reaches the same factory
const FACTORY = new Set(["createElement", "jsx", "jsxs", "jsxDEV", "jsxsDEV", "h"]); // JSX without JSX syntax
const alt = (xs: string[]) => [...new Set(xs)].sort((a, b) => b.length - a.length).join("|");
const RULES: { id: number; re: RegExp; msg: string }[] = [
  { id: 1, re: new RegExp(`import\\s*\\{[^}]*\\b(?:${alt([...CONSTRUCTS, "Span", "Textarea", "Markdown", "Diff", "LineNumber", "ScrollBar", "Slider", "TextTable"])})\\b[^}]*\\}\\s*from\\s*["']@opentui/react["']`, "g"), msg: "@opentui/react exports no capitalized renderable — only lowercase intrinsics, hooks, createRoot and extend" },
  { id: 2, re: new RegExp(`<(?:${alt(["ScrollBox", "Scrollbox", "TabSelect", "AsciiFont", "ASCIIFont", "LineNumber", "TextArea"])})\\b`, "g"), msg: "capitalized form of a kebab intrinsic — write <scrollbox>, <tab-select>, <ascii-font>, <line-number>, <textarea>" },
  { id: 3, re: /<(?:ascii_font|tab_select|line_number|scroll_box|text_table)\b/g, msg: "Solid's snake_case intrinsic in a React surface — React spells these kebab-case" },
  { id: 5, re: /<(?:text|span)\b[^>]*\bcontent\s*=/g, msg: "surface hygiene: `content?: string` DOES exist on React TextProps, so this compiles — it is banned because it is the core spelling of what React expresses as children. Write <text>value</text>" },
];

// ── parse ────────────────────────────────────────────────────────────────────────────────────
const mkSf = (text: string, k: ts.ScriptKind) => ts.createSourceFile(k === ts.ScriptKind.TSX ? "u.tsx" : "u.ts", text, ts.ScriptTarget.Latest, true, k);
const errs = (sf: ts.SourceFile) => ((sf as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? []).length;
/** Parse in the dialect the extension/lang implies, but keep the other when it fits better: a
 *  ```ts fence may hold JSX, and `<T>x` in a .ts file is a cast, not a tag. */
function parse(text: string, tsx: boolean): { sf: ts.SourceFile; bad: number } {
  const a = mkSf(text, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS), ea = errs(a);
  if (ea === 0) return { sf: a, bad: 0 };
  const b = mkSf(text, tsx ? ts.ScriptKind.TS : ts.ScriptKind.TSX), eb = errs(b);
  return eb < ea ? { sf: b, bad: eb } : { sf: a, bad: ea };
}
/** Peel the wrappers that hide a callee: `(Box)`, `(0, core.Box)`, `Box!`, `Box as F`, `<F>Box`. */
function peel(n: ts.Node): ts.Node {
  for (let x = n; ; ) {
    if (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || x.kind === ts.SyntaxKind.TypeAssertionExpression) { x = (x as ts.ParenthesizedExpression).expression; continue; }
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.CommaToken) { x = x.right; continue; }
    return x;
  }
}
/** A string known at parse time: a literal, a template with no substitution, or a const holding one. */
type Lit = (n: ts.Node) => string | null;
const LITERAL: Lit = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);
/** `o.Box`, `o["Box"]`, o[`Box`] and `o[k]` alike — the member name, or null when it is truly dynamic. */
function member(n: ts.Node, lit: Lit = LITERAL): string | null {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n)) return lit(peel(n.argumentExpression));
  return null;
}
const target = (n: ts.Node): ts.Node | null => (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) ? peel(n.expression) : null);
function bound(n: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(n)) { out.add(n.text); return; }
  for (const el of n.elements) if (ts.isBindingElement(el)) bound(el.name, out);
}
/** `{ Box }` / `{ Box: B }` / `{ ...rest }` off a core namespace — where the constructs end up. */
function unpack(p: ts.BindingName, add: (local: string) => void, rest?: (local: string) => void): void {
  if (!ts.isObjectBindingPattern(p)) return;
  for (const el of p.elements) {
    if (!ts.isIdentifier(el.name)) continue;
    if (el.dotDotDotToken) { rest?.(el.name.text); continue; } // const { ...rest } = core — rest IS the namespace
    const src = el.propertyName && !ts.isComputedPropertyName(el.propertyName) ? el.propertyName.text : el.name.text;
    if (CONSTRUCTS.includes(src)) add(el.name.text);
  }
}
/** One expression can name more than one value: `flag ? Box : Text`, `Box ?? fallback`. */
function sources(n: ts.Node): ts.Node[] {
  const x = peel(n);
  if (ts.isConditionalExpression(x)) return [...sources(x.whenTrue), ...sources(x.whenFalse)];
  if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.BarBarToken || x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return [...sources(x.left), ...sources(x.right)];
  return [x];
}

// ── bindings: which names in THIS unit actually reach @opentui/core ───────────────────────────
/** Returns the predicate rule 4 turns on. `declared` is every value binding in the unit; a name
 *  declared here and not traced to core is the user's own. A CONSTRUCT name that is never declared
 *  is free — doc snippets omit their imports, and that must still count. */
function bindings(sf: ts.SourceFile): { isCore: (n: ts.Node) => boolean; lit: Lit } {
  const declared = new Set<string>(), core = new Set<string>(), ns = new Set<string>(), str = new Map<string, string>();
  const links: { to: ts.BindingName; from: ts.Expression }[] = []; // const B = Box · B = core.Box
  const modOf = (e: ts.Expression | undefined): string | null => {
    if (!e) return null;
    let x: ts.Node = peel(e);
    if (ts.isAwaitExpression(x)) x = peel(x.expression);
    if (!ts.isCallExpression(x) || x.arguments.length === 0) return null;
    const a0 = x.arguments[0]!, callee = peel(x.expression);
    if (!ts.isStringLiteral(a0) && !ts.isNoSubstitutionTemplateLiteral(a0)) return null;
    return callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require") ? a0.text : null;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause, live = !!c && !c.isTypeOnly && CORE_MOD.test(n.moduleSpecifier.text);
      if (c?.name) { declared.add(c.name.text); if (live) ns.add(c.name.text); }
      const nb = c?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) { declared.add(nb.name.text); if (live) ns.add(nb.name.text); }
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
        declared.add(el.name.text);
        if (live && !el.isTypeOnly && CONSTRUCTS.includes((el.propertyName ?? el.name).text)) core.add(el.name.text);
      }
    }
    if (ts.isImportEqualsDeclaration(n)) { // import core = require("@opentui/core")
      declared.add(n.name.text);
      const r = n.moduleReference;
      if (ts.isExternalModuleReference(r) && ts.isStringLiteral(r.expression) && CORE_MOD.test(r.expression.text)) ns.add(n.name.text);
    }
    if (ts.isVariableDeclaration(n)) {
      bound(n.name, declared);
      const mod = modOf(n.initializer); // const { Box } = await import("@opentui/core") / require(…)
      if (mod && CORE_MOD.test(mod)) { if (ts.isIdentifier(n.name)) ns.add(n.name.text); else unpack(n.name, (l) => core.add(l), (l) => ns.add(l)); }
      else if (n.initializer) {
        links.push({ to: n.name, from: n.initializer });
        const s = n.initializer && LITERAL(peel(n.initializer)); // const k = "Box" · core[k]({…})
        if (s !== null && ts.isIdentifier(n.name)) str.set(n.name.text, s);
      }
    }
    if (ts.isCallExpression(n) && member(peel(n.expression)) === "then") { // import("@opentui/core").then(m => …)
      const recv = target(peel(n.expression)), fn = n.arguments[0];
      if (recv && modOf(recv as ts.Expression) && CORE_MOD.test(modOf(recv as ts.Expression)!) && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        const p = fn.parameters[0]?.name;
        if (p && ts.isIdentifier(p)) ns.add(p.text);
        else if (p) unpack(p, (l) => core.add(l), (l) => ns.add(l));
      }
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) links.push({ to: n.left, from: n.right });
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n) || ts.isEnumDeclaration(n)) && n.name) declared.add(n.name.text);
    if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) declared.add(n.name.text);
    if (ts.isParameter(n) || ts.isBindingElement(n)) bound(n.name, declared);
    if (ts.isCatchClause(n) && n.variableDeclaration) bound(n.variableDeclaration.name, declared);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  const lit: Lit = (n) => LITERAL(n) ?? (ts.isIdentifier(n) ? str.get(n.text) ?? null : null);
  const one = (x: ts.Node): boolean => {
    if (ts.isIdentifier(x)) return core.has(x.text) || (!declared.has(x.text) && CONSTRUCTS.includes(x.text));
    const m = member(x, lit), o = target(x);
    if (!m || !CONSTRUCTS.includes(m) || !o) return false;
    return (ts.isIdentifier(o) && ns.has(o.text)) || CORE_MOD.test(modOf(o as ts.Expression) ?? ""); // (await import("@opentui/core")).Box
  };
  const isCore = (node: ts.Node): boolean => sources(node).some(one); // `(flag ? Box : Text)({…})` is still a call
  for (let pass = 0; pass < 8; pass++) { // aliases of aliases: const B = Box; const C = B
    const size = core.size + ns.size;
    for (const { to, from } of links) for (const src of sources(from)) { // `const B = flag ? Box : Text` binds both
      if (ts.isIdentifier(to)) {
        if (isCore(src)) core.add(to.text);
        else if (ts.isIdentifier(src) && ns.has(src.text)) ns.add(to.text);
      } else if (ts.isIdentifier(src) && ns.has(src.text)) unpack(to, (l) => core.add(l), (l) => ns.add(l)); // const { Box: B } = core
    }
    if (core.size + ns.size === size) break;
  }
  return { isCore, lit };
}

// ── surfaces: the first construct use and the first intrinsic in one unit ─────────────────────
type Hit = { pos: number; text: string };
type Surf = { jsx: Hit | null; con: Hit | null };
function surfaces(sf: ts.SourceFile, { isCore, lit }: { isCore: (n: ts.Node) => boolean; lit: Lit }): Surf {
  let jsx: Hit | null = null, con: Hit | null = null;
  const cut = (n: ts.Node): Hit => ({ pos: n.getStart(sf), text: n.getText(sf).split("\n")[0]!.slice(0, 140) });
  const visit = (n: ts.Node): void => {
    if (jsx && con) return;
    if (ts.isTypeNode(n) && n.kind !== ts.SyntaxKind.ExpressionWithTypeArguments) return; // `typeof Box` is not a use
    if (ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n)) return; // importing core is never the violation
    if (!jsx && (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))) {
      const tag = n.tagName.getText(sf);
      if (INTRINSICS.includes(tag)) jsx = { pos: n.getStart(sf), text: `<${tag}>` };
    }
    if (ts.isCallExpression(n)) {
      const callee = peel(n.expression), m = member(callee, lit), fname = ts.isIdentifier(callee) ? callee.text : m, a0 = n.arguments[0];
      // React without JSX syntax: createElement("box", …) is still the React surface, even in a .ts file
      const tag = a0 && lit(peel(a0));
      if (!jsx && fname && FACTORY.has(fname) && tag && INTRINSICS.includes(tag)) jsx = { pos: n.getStart(sf), text: `<${tag}>` };
      if (!con) {
        const recv = target(callee);
        if (isCore(callee)) con = cut(n); //                                   Box(…) · (Text)(…) · core["Box"](…)
        else if (m && THUNK.has(m) && recv && isCore(recv)) con = cut(n); //    Box.call(null, opts)
        else for (const a of n.arguments) if (isCore(a)) { con = cut(a); break; } // Reflect.apply(Box, …) · render(Box)
      }
    }
    if (!con && ts.isNewExpression(n)) {
      const c = peel(n.expression), nm = ts.isIdentifier(c) ? c.text : member(c, lit);
      if ((nm && nm.endsWith("Renderable") && nm.length > "Renderable".length) || isCore(c)) con = cut(n);
    }
    if (!con && ts.isArrayLiteralExpression(n)) for (const el of n.elements) if (isCore(el)) { con = cut(el); break; }
    if (!con && ts.isPropertyAssignment(n) && isCore(n.initializer)) con = cut(n.initializer); // { make: Box }
    if (!con && ts.isShorthandPropertyAssignment(n) && isCore(n.name)) con = cut(n.name); //     { Box }
    if (!con && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && !ts.isIdentifier(n.left) && isCore(n.right)) con = cut(n); // globalThis.Box = Box
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return { jsx, con };
}

// ── units ────────────────────────────────────────────────────────────────────────────────────
type Unit = { label: string; line0: number; text: string; tsx: boolean; kind: string; gated: boolean; counted: boolean; strict: boolean };
const at = (u: Unit, i: number) => u.line0 + u.text.slice(0, i).split("\n").length; // 1-based file line
const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/; // any indent: a fence under a list item is indented to the item's content column
/** An INDEPENDENT probe for "this file MEANT to show code", deliberately sharing no logic with the
 *  extractor above: a line that opens with a fence run and names a code language. A file that trips
 *  this and yields no block is the only shape where "0 blocks" is diagnostic — the two disagree, and
 *  the snippet is then invisible to a reader too. A README with only ```bash, or with no fence at
 *  all, is an ordinary consumer project and says nothing about extraction. */
const LOOKS_FENCED = /^[ \t>]*(?:`{3,}|~{3,})[ \t]*\{?(?:[cm]?tsx?|[cm]?jsx?|typescript|javascript|typescriptreact|javascriptreact)\b/gim;

/** Every code unit in a markdown file. Line numbers survive because de-quoting rewrites lines in
 *  place; `strict` units (unlabelled fence, indented block) are scanned only if they parse. */
function mdUnits(label: string, text: string, gateLine: number): Unit[] {
  const line = text.split("\n").map((l) => l.replace(/^(?: {0,3}>[ \t]?)+/, "")); // `> ```tsx` opens a real fence
  const out: Unit[] = [], covered = new Array<boolean>(line.length).fill(false);
  let open = -1, mark = "", lang = "";
  const shut = (end: number) => {
    const known = CODE_LANG.has(lang);
    for (let k = open; k < end && k < line.length; k++) covered[k] = true;
    out.push({ label, line0: open + 1, text: line.slice(open + 1, end).join("\n"), tsx: !TS_LANG.has(lang), gated: open > gateLine, counted: known, strict: !known, kind: known ? "block" : "unlabelled block" });
    open = -1;
  };
  for (let i = 0; i < line.length; i++) {
    const m = FENCE.exec(line[i]!);
    if (open < 0) {
      if (!m || (m[1]![0] === "`" && m[2]!.includes("`"))) continue; // CommonMark: no backtick in a ``` info string
      open = i; mark = m[1]!; lang = (/[A-Za-z0-9_+#-]+/.exec(m[2]!) ?? [""])[0]!.toLowerCase();
    } else if (m && m[1]![0] === mark[0] && m[1]!.length >= mark.length && m[2] === "") shut(i);
  }
  if (open >= 0) shut(line.length); // an unterminated fence runs to EOF — dropping the closer hides nothing
  let run = -1; // markdown's OTHER code block: a 4-space indent, no fence
  for (let i = 0; i <= line.length; i++) {
    const l = i < line.length ? line[i]! : "";
    if (i < line.length && !covered[i] && (/^(?: {4}|\t)/.test(l) || (run >= 0 && /^\s*$/.test(l)))) { if (run < 0) run = i; continue; }
    if (run >= 0) {
      const body = line.slice(run, i).map((x) => x.replace(/^(?: {4}|\t)/, ""));
      while (body.length && /^\s*$/.test(body[body.length - 1]!)) body.pop();
      out.push({ label, line0: run, text: body.join("\n"), tsx: true, gated: run > gateLine, counted: false, strict: true, kind: "indented block" });
      run = -1;
    }
  }
  return out;
}
const look = (u: Unit): Surf | null => {
  const { sf, bad } = parse(u.text, u.tsx);
  return u.strict && bad > 0 ? null : surfaces(sf, bindings(sf));
};
const MIX = (u: Unit, s: Surf, j: Unit) => `MIXED SURFACE — construct call in the same ${u === j ? u.kind : "file"} as JSX intrinsic \`${s.jsx!.text}\` (line ${at(j, s.jsx!.pos)}). Split them: constructs in a core-only module, JSX in a react module`;

type Scan = { v: string[]; blocks: number; expect: number };
/** The one shape where "0 fenced blocks" means something is broken rather than "this is an app". */
const unpaired = (r: Scan) => r.expect > 0 && r.blocks === 0;

function scanFile(rel: string, raw: string): Scan {
  // CRLF and a BOM are invisible to a reader and fatal to a line-anchored fence match: a markdown
  // file saved on Windows had NO fences at all, which is a whole-file bypass. Line COUNT is kept.
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const v: string[] = [], md = /\.mdx?$/.test(rel), mixOk = ALLOW_MIX.some((a) => rel.endsWith(a));
  const flag = (u: Unit, i: number, id: number, msg: string, hit: string) => v.push(`${u.label}:${at(u, i)}: [rule ${id}] ${msg}\n      ${hit.trim()}`);
  const whole: Unit = { label: rel, line0: 0, text, tsx: !/\.[cm]?ts$/.test(rel), kind: "file", gated: false, counted: false, strict: false };
  const expect = md ? [...text.matchAll(LOOKS_FENCED)].length : 0;
  RULES.forEach((r) => [...text.matchAll(r.re)].forEach((m) => flag(whole, m.index, r.id, r.msg, m[0]))); // prose AND code, real lines
  if (!md) {
    const s = look(whole)!;
    if (!mixOk && s.jsx && s.con) flag(whole, s.con.pos, 4, MIX(whole, s, whole), s.con.text);
    return { v, blocks: 0, expect };
  }
  const g = text.split("\n").findIndex((l) => l.includes(GATE));
  const live: { u: Unit; s: Surf }[] = [];
  let blocks = 0;
  for (const u of mdUnits(rel, text, g < 0 ? Infinity : g)) {
    if (u.counted) blocks++;
    if (u.gated || !u.text.trim()) continue;
    const s = look(u);
    if (s) live.push({ u, s });
  }
  if (mixOk) return { v, blocks, expect };
  const before = v.length;
  for (const { u, s } of live) if (s.jsx && s.con) flag(u, s.con.pos, 4, MIX(u, s, u), s.con.text);
  if (v.length > before) return { v, blocks, expect }; // a block-scoped report beats repeating it at file scope
  const j = live.find((x) => x.s.jsx), c = live.find((x) => x.s.con); // …and the invariant is per FILE too
  if (j && c) flag(c.u, c.s.con!.pos, 4, MIX(c.u, { jsx: j.s.jsx, con: c.s.con }, j.u), c.s.con!.text);
  return { v, blocks, expect };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SCAN.test(e.name)) out.push(p);
  }
  return out;
}

if (Bun.argv[2] === "--self-test") { // negative controls — see scripts/fixtures/README.md
  const dir = join(import.meta.dir, "fixtures");
  const rows = walk(dir).filter((p) => !p.endsWith("README.md")).map((abs) => {
    const name = relative(dir, abs), text = readFileSync(abs, "utf8"), r = scanFile(name, text), v = r.v;
    // Each fixture states its own expectation, so a bypass cannot pass by tripping an unrelated rule.
    const want = [...text.matchAll(/EXPECT rules?\s+([\d\s,+&and]+)/g)].flatMap((m) => m[1]!.split(/\D+/).filter(Boolean).map(Number));
    const got = new Set(v.map((s) => Number(/\[rule (\d+)\]/.exec(s)?.[1])));
    const exact = /EXPECT (\d+) violations?/.exec(text); // a fixture proving N independent forms
    const nb = /EXPECT (\d+) blocks?/.exec(text); // …and that extraction classified them as it should
    const clean = /EXPECT clean/.test(text);
    // The 0-blocks alarm, asserted from both sides: an app's README must not trip it, a fence that
    // opened and produced nothing must.
    const warn = /EXPECT warning/.test(text), quiet = /EXPECT no warning/.test(text);
    // A gap this linter does NOT close is carried as a fixture and PRINTED on every run, because a
    // known hole that nobody is reminded of decays into a hole nobody knows about.
    if (/EXPECT known gap/.test(text)) return { name, v, gap: true, note: v.length ? "known gap — NOW CLOSED, promote it to a bypass fixture" : "known gap — still open", ok: true };
    if (!clean && want.length === 0) return { name, v, gap: false, note: "no EXPECT marker", ok: false };
    const note = `${clean ? "must be clean" : `must flag rule ${want.join("+")}${exact ? ` ×${exact[1]}` : ""}`}${nb ? `, ${nb[1]} counted block(s)` : ""}${warn ? ", must warn" : quiet ? ", must not warn" : ""}`;
    const ok = (clean ? v.length === 0 : want.every((w) => got.has(w)) && (!exact || v.length === Number(exact[1])))
      && (!nb || r.blocks === Number(nb[1])) && (!warn || unpaired(r)) && (!quiet || !unpaired(r));
    return { name, v, gap: false, note, ok };
  }).sort((a, b) => a.name.localeCompare(b.name));
  for (const r of rows) {
    console.log(`  ${r.gap ? (r.v.length ? "CLOSED" : " GAP ") : r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.note}, got ${r.v.length}`);
    if (!r.ok) r.v.forEach((s) => console.log(`          ${s.split("\n")[0]}`));
  }
  const bad = rows.filter((r) => !r.ok).length, gaps = rows.filter((r) => r.gap).length;
  console.log(`check-surface --self-test: ${rows.length - bad - gaps}/${rows.length - gaps} fixtures behave correctly, ${gaps} known gap(s) documented`);
  process.exit(bad > 0 ? 1 : 0);
}

const DUMP = Bun.argv[2] === "--blocks";
const ROOT = (DUMP ? Bun.argv[3] : Bun.argv[2]) ?? join(import.meta.dir, "..");
const violations: string[] = [], unpairedIn: string[] = [];
let srcFiles = 0, mdFiles = 0, blocks = 0;
for (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs);
  if (ALLOW_ALL.some((a) => rel.endsWith(a))) continue;
  const text = readFileSync(abs, "utf8");
  if (DUMP && /\.mdx?$/.test(rel)) {
    const g = text.split("\n").findIndex((l) => l.includes(GATE));
    for (const u of mdUnits(rel, text, g < 0 ? Infinity : g)) {
      const s = u.text.trim() ? look(u) : null;
      console.log(`  ${rel}:${u.line0 + 1} ${u.kind}${u.gated ? " [gated]" : ""} — ${u.text.split("\n").length} line(s), ${s ? `jsx=${!!s.jsx} construct=${!!s.con}` : "not code"}`);
    }
  }
  const r = scanFile(rel, text);
  violations.push(...r.v);
  blocks += r.blocks;
  if (unpaired(r)) unpairedIn.push(rel);
  if (/\.mdx?$/.test(rel)) mdFiles++; else srcFiles++;
}
if (srcFiles + mdFiles === 0) { console.error(`check-surface: scanned NOTHING under ${ROOT} — wrong ROOT? (a failure, not a pass)`); process.exit(2); }
console.log(`check-surface: scanned ${srcFiles} source file(s), ${mdFiles} markdown file(s), ${blocks} fenced ts/tsx/jsx block(s)`);
// NOT "0 blocks anywhere": an app whose README carries no ts fence is the normal case, and SKILL.md
// tells consumer projects to run this. Only a file that opened a ts fence and yielded nothing is news.
if (unpairedIn.length > 0) console.warn(`check-surface: WARNING extraction produced no block for ${unpairedIn.length} file(s) that open a ts/tsx fence — ${unpairedIn.join(", ")}`);
if (violations.length > 0) { console.error(`\n${violations.length} surface violation(s):\n${violations.map((v) => `  ${v}`).join("\n")}`); process.exit(1); }
console.log("check-surface: clean — no mixed-surface snippets.");
