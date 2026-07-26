#!/usr/bin/env python3
"""
audit_ui.py — design-system guardrails audit.

Zero-dependency scan of a frontend repo for style-drift violations:

  [E] hardcoded-color      hex / rgb() / hsl() / oklch() literals outside token files
  [E] arbitrary-value      Tailwind arbitrary values like w-[347px], bg-[#fff]
                           (layout-ish grid/col/row arbitraries downgraded to warning)
  [E] inline-style         style= / :style= attributes (CSS-var passthrough downgraded)
  [W] appearance-override  appearance classes (bg-, rounded-, shadow-, p-…) passed to
                           a Capitalized component at a call site — should be a variant
  [W] raw-palette          primitive palette classes (bg-blue-500) — prefer semantic tokens
  [W] missing-story        library component file without a matching *.stories.* file

Usage:
  python3 audit_ui.py [path] [--json] [--max N] [--allow GLOB ...] [--lib PATH ...]
                      [--layout-components A,B,C] [--skip check1,check2]

Exit code: 1 if any errors found (CI-friendly), else 0.
Heuristic by design — it flags for review; it does not prove correctness.
"""

import argparse
import fnmatch
import json
import re
import sys
import time
from pathlib import Path

SCAN_EXTS = {".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs", ".vue", ".svelte",
             ".astro", ".html", ".css", ".scss", ".sass", ".less", ".mdx"}

SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
             ".svelte-kit", "coverage", "storybook-static", ".storybook", "public",
             "vendor", ".turbo", ".cache", ".venv", "__pycache__", "target", ".output"}

# Files where raw values are the point (token definitions / theme entry).
DEFAULT_ALLOW = ["tokens.*", "*.tokens.*", "theme.*", "*.theme.*", "tailwind.config.*",
                 "app.css", "globals.css", "global.css", "index.css", "main.css",
                 "variables.css", "preview.*"]

# Library components allowed to receive className freely (layout primitives).
DEFAULT_LAYOUT_COMPONENTS = {"Box", "Stack", "HStack", "VStack", "Grid", "Flex",
                             "Container", "Spacer", "Center", "Section"}

# --- regexes ---------------------------------------------------------------

HEX_RE = re.compile(r"""(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F\w-])""")
COLOR_FN_RE = re.compile(r"\b(?:rgba?|hsla?|oklch|oklab|lch|lab)\(")
ARBITRARY_RE = re.compile(r"""(?:^|[\s"'`{:!])((?:[a-zA-Z][\w/.:-]*)-\[[^\]\n]{1,80}\])""")
LAYOUT_ARBITRARY_PREFIX = re.compile(r"^(?:grid|col|row|auto|basis|order|aspect|minmax)")
INLINE_STYLE_RE = re.compile(r"""(?<!<)\bstyle\s*=\s*["'{]|:style\s*=""")
CLASS_ATTR_RE = re.compile(r"""(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:cn\(|clsx\(|cva\()?\s*[`"']([^`"']*)[`"'])""")
COMPONENT_TAG_RE = re.compile(r"<([A-Z][A-Za-z0-9.]*)\b")
PALETTE_RE = re.compile(
    r"\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow)-"
    r"(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b")

TEXT_LAYOUT_UTILS = {"left", "center", "right", "justify", "start", "end", "balance",
                     "pretty", "wrap", "nowrap", "clip", "ellipsis", "truncate"}
APPEARANCE_PREFIXES = ("bg-", "border", "rounded", "shadow", "font-", "ring-", "fill-",
                       "stroke-", "opacity-", "leading-", "tracking-", "underline",
                       "italic", "uppercase", "lowercase", "capitalize", "backdrop-",
                       "divide-", "outline-", "decoration-")
PADDING_RE = re.compile(r"^p[trblxyes]?-")
STATE_PREFIX_RE = re.compile(r"^(?:hover|focus|focus-visible|active|disabled|dark|group-hover|peer-|aria-|data-)[:\[]")


def is_appearance_class(cls: str) -> bool:
    cls = cls.strip()
    if not cls:
        return False
    if STATE_PREFIX_RE.match(cls):
        return True  # states/dark-mode handling belongs inside the component
    base = cls.split(":")[-1]  # strip responsive prefixes like md:
    if base.startswith("text-"):
        rest = base[5:]
        return rest.split("-")[0] not in TEXT_LAYOUT_UTILS
    if PADDING_RE.match(base):
        return True   # padding is part of the component's proportions (size variant)
    return base.startswith(APPEARANCE_PREFIXES)


def matches_any(name: str, patterns) -> bool:
    return any(fnmatch.fnmatch(name, p) for p in patterns)


class Finding:
    __slots__ = ("check", "severity", "path", "line", "snippet", "message")

    def __init__(self, check, severity, path, line, snippet, message):
        self.check, self.severity = check, severity
        self.path, self.line = path, line
        self.snippet, self.message = snippet[:120], message

    def to_dict(self):
        return {"check": self.check, "severity": self.severity, "file": str(self.path),
                "line": self.line, "snippet": self.snippet, "message": self.message}


def iter_files(root: Path):
    for p in sorted(root.rglob("*")):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.is_file() and p.suffix.lower() in SCAN_EXTS:
            yield p


def scan_file(path: Path, rel: Path, allow_patterns, layout_components, skip, findings):
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    allowed_values = matches_any(path.name, allow_patterns)
    jsx_like = path.suffix in {".tsx", ".jsx", ".vue", ".svelte", ".astro", ".mdx"}
    is_story = ".stories." in path.name

    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()

        # 1. hardcoded colors
        if "hardcoded-color" not in skip and not allowed_values:
            m = HEX_RE.search(line) or COLOR_FN_RE.search(line)
            if m and "url(" not in line:
                findings.append(Finding("hardcoded-color", "error", rel, i, stripped,
                                        "raw color literal — use a design token"))

        # 2. Tailwind arbitrary values
        if "arbitrary-value" not in skip and not allowed_values:
            for m in ARBITRARY_RE.finditer(line):
                token = m.group(1)
                if LAYOUT_ARBITRARY_PREFIX.match(token):
                    findings.append(Finding("arbitrary-value", "warning", rel, i, token,
                                            "layout arbitrary value — consider a theme token"))
                else:
                    findings.append(Finding("arbitrary-value", "error", rel, i, token,
                                            "arbitrary value — add a token to the theme instead"))

        # 3. inline styles
        if "inline-style" not in skip and (jsx_like or path.suffix == ".html"):
            if INLINE_STYLE_RE.search(line) and "<style" not in line:
                sev = "warning" if "--" in line else "error"
                msg = ("CSS-variable passthrough — verify it's the only use"
                       if sev == "warning" else "inline style — use tokens/variants")
                findings.append(Finding("inline-style", sev, rel, i, stripped, msg))

        # 4. appearance classes passed to components at call sites
        if "appearance-override" not in skip and jsx_like and not is_story:
            tag = COMPONENT_TAG_RE.search(line)
            attr = CLASS_ATTR_RE.search(line)
            if tag and attr and tag.start() < attr.start():
                name = tag.group(1).split(".")[-1]
                if name not in layout_components:
                    classes = next(g for g in attr.groups() if g is not None)
                    bad = [c for c in classes.split() if is_appearance_class(c)]
                    if bad:
                        findings.append(Finding(
                            "appearance-override", "warning", rel, i,
                            f"<{name} className=\"…{' '.join(bad[:4])}…\">",
                            "appearance styling on a component call site — move into a variant"))

        # 5. primitive palette classes
        if "raw-palette" not in skip and not allowed_values:
            m = PALETTE_RE.search(line)
            if m:
                findings.append(Finding("raw-palette", "warning", rel, i, m.group(0),
                                        "primitive palette class — prefer a semantic token"))


def check_missing_stories(root: Path, lib_globs, skip, findings):
    if "missing-story" in skip:
        return
    lib_dirs = []
    for p in sorted(root.rglob("*")):
        if p.is_dir() and not any(part in SKIP_DIRS for part in p.parts):
            rp = p.relative_to(root).as_posix()
            if any(fnmatch.fnmatch(rp, g) or g in rp for g in lib_globs):
                lib_dirs.append(p)
    if not lib_dirs:
        return
    story_stems = set()
    for p in root.rglob("*.stories.*"):
        story_stems.add(p.name.split(".stories.")[0].lower())
    seen = set()
    for d in lib_dirs:
        for p in d.rglob("*"):
            if (p.is_file() and p.suffix in {".tsx", ".jsx", ".vue", ".svelte"}
                    and p not in seen and not any(part in SKIP_DIRS for part in p.parts)):
                seen.add(p)
                name = p.name
                if (".stories." in name or ".test." in name or ".spec." in name
                        or name.startswith(("index.", "use-"))
                        or name.endswith(".d.ts")):
                    continue
                stem = name.rsplit(".", 1)[0].lower()
                if stem not in story_stems:
                    findings.append(Finding("missing-story", "warning",
                                            p.relative_to(root), 0, name,
                                            "library component has no *.stories.* file"))


def main():
    ap = argparse.ArgumentParser(description="Design-system guardrails audit")
    ap.add_argument("path", nargs="?", default=".", help="repo or directory to scan")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--max", type=int, default=15, help="max findings shown per check (text mode)")
    ap.add_argument("--allow", action="append", default=[],
                    help="extra filename glob where raw values are allowed (repeatable)")
    ap.add_argument("--lib", action="append", default=[],
                    help="library dir path fragment/glob for the missing-story check "
                         "(default: components/ui, design-system)")
    ap.add_argument("--layout-components", default="",
                    help="comma-separated extra component names allowed to take className")
    ap.add_argument("--skip", default="", help="comma-separated checks to skip")
    args = ap.parse_args()

    root = Path(args.path).resolve()
    if not root.exists():
        print(f"path not found: {root}", file=sys.stderr)
        sys.exit(2)

    allow = DEFAULT_ALLOW + args.allow
    layout_components = DEFAULT_LAYOUT_COMPONENTS | {
        s.strip() for s in args.layout_components.split(",") if s.strip()}
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    lib_globs = args.lib or ["components/ui", "design-system", "packages/ui"]

    t0 = time.time()
    findings, n_files = [], 0
    for f in iter_files(root):
        n_files += 1
        scan_file(f, f.relative_to(root), allow, layout_components, skip, findings)
    check_missing_stories(root, lib_globs, skip, findings)
    elapsed = int((time.time() - t0) * 1000)

    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity == "warning"]

    if args.json:
        print(json.dumps({"root": str(root), "files_scanned": n_files, "ms": elapsed,
                          "errors": len(errors), "warnings": len(warnings),
                          "findings": [f.to_dict() for f in findings]}, indent=2))
    else:
        print(f"UI Guardrails Audit — {root}")
        print(f"Scanned {n_files} files in {elapsed} ms\n")
        by_check = {}
        for f in findings:
            by_check.setdefault(f.check, []).append(f)
        order = ["hardcoded-color", "arbitrary-value", "inline-style",
                 "appearance-override", "raw-palette", "missing-story"]
        for check in order:
            items = by_check.get(check, [])
            if not items:
                continue
            sev = "E" if any(i.severity == "error" for i in items) else "W"
            print(f"[{sev}] {check} ({len(items)})")
            for f in items[:args.max]:
                loc = f"{f.path}:{f.line}" if f.line else f"{f.path}"
                print(f"    {loc}  {f.snippet}")
                print(f"        → {f.message}")
            if len(items) > args.max:
                print(f"    … +{len(items) - args.max} more (raise with --max)")
            print()
        if not findings:
            print("No violations found. ✔")
        print(f"Summary: {len(errors)} errors, {len(warnings)} warnings "
              f"({len(findings)} findings)")

    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
