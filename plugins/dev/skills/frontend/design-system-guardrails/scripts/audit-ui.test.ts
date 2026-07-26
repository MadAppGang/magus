/**
 * Regression tests for audit-ui.ts.
 *
 * The two false-positive classes below are why this file exists — the original
 * Python implementation reported 6 errors on a canonical shadcn/ui component,
 * which made the CI gate the skill recommends permanently red.
 *
 * Run: bun test plugins/dev/skills/frontend/design-system-guardrails/scripts/
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dir, "audit-ui.ts");
const tempDirs: string[] = [];

interface Finding {
  check: string;
  severity: "error" | "warning";
  file: string;
  line: number;
  snippet: string;
  message: string;
}

/** Write `files` into a temp dir, audit it, return the parsed findings. */
function audit(files: Record<string, string>, args: string[] = []): Finding[] {
  const root = mkdtempSync(join(tmpdir(), "audit-ui-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const proc = Bun.spawnSync(["bun", SCRIPT, root, "--json", ...args]);
  const stdout = proc.stdout.toString();
  if (!stdout.trim()) throw new Error(`no output: ${proc.stderr.toString()}`);
  return JSON.parse(stdout).findings as Finding[];
}

const checks = (f: Finding[], check: string) => f.filter((x) => x.check === check);
const errors = (f: Finding[]) => f.filter((x) => x.severity === "error");

afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe("Tailwind variant selectors are conditions, not arbitrary values", () => {
  test("a canonical shadcn/ui component produces zero findings", () => {
    const findings = audit({
      "src/components/ui/checkbox.tsx": `
        <Root className={cn(
          "peer size-4 shrink-0 rounded-sm border border-primary",
          "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
          "aria-[invalid=true]:border-destructive",
          "has-[>svg]:px-3 group-data-[side=left]:rotate-180",
          "supports-[backdrop-filter]:bg-surface/60",
          "[&_svg]:size-4 not-[:first-child]:mt-2 @max-[600px]:hidden",
        )} />`,
      "src/components/ui/checkbox.stories.tsx": "export const Default = {}",
    });
    expect(findings).toEqual([]);
  });

  test.each([
    ["data-[state=open]", "data-[state=open]:bg-primary"],
    ["aria-[invalid=true]", "aria-[invalid=true]:border-destructive"],
    ["has-[>svg]", "has-[>svg]:px-3"],
    ["group-data-[side=left]", "group-data-[side=left]:rotate-180"],
    ["supports-[backdrop-filter]", "supports-[backdrop-filter]:bg-surface"],
    ["arbitrary variant", "[&_svg]:size-4"],
    // A ":" inside brackets must not split the variant chain.
    ["colon inside brackets", "not-[:first-child]:mt-2"],
  ])("%s is not an arbitrary value", (_label, cls) => {
    const findings = audit({ "src/a.tsx": `<div className="${cls}" />` });
    expect(checks(findings, "arbitrary-value")).toEqual([]);
  });

  test.each([
    ["plain", "w-[347px]"],
    ["behind a responsive variant", "md:w-[347px]"],
    ["behind a data variant", "data-[state=open]:bg-[#ff0000]"],
    ["with an important prefix", "!bg-[#fff]"],
    ["containing parens", "w-[calc(100%-1rem)]"],
  ])("still flags a real arbitrary value: %s", (_label, cls) => {
    const findings = audit({ "src/a.tsx": `<div className="${cls}" />` });
    expect(checks(findings, "arbitrary-value").length).toBeGreaterThan(0);
    expect(checks(findings, "arbitrary-value")[0]!.severity).toBe("error");
  });

  test("layout arbitraries are downgraded to warnings", () => {
    const findings = audit({
      "src/a.tsx": `<div className="grid-cols-[repeat(2,minmax(0,1fr))]" />`,
    });
    const arb = checks(findings, "arbitrary-value");
    expect(arb).toHaveLength(1);
    expect(arb[0]!.severity).toBe("warning");
    // parens inside the bracket must survive tokenization
    expect(arb[0]!.snippet).toBe("grid-cols-[repeat(2,minmax(0,1fr))]");
  });
});

describe("CSS id selectors are not colors", () => {
  test.each(["#abc", "#beef", "#face", "#dad"])(
    "%s in selector position is not flagged",
    (id) => {
      const findings = audit({ "src/a.css": `${id} { color: var(--c); }` });
      expect(checks(findings, "hardcoded-color")).toEqual([]);
    },
  );

  test("a selector with a pseudo-class is still not flagged", () => {
    const findings = audit({ "src/a.css": "#beef:hover { color: var(--c); }" });
    expect(checks(findings, "hardcoded-color")).toEqual([]);
  });

  test("a hex in value position is still flagged", () => {
    const findings = audit({ "src/a.css": ".bad { background: #1a56db; }" });
    expect(checks(findings, "hardcoded-color")).toHaveLength(1);
  });

  test("a hex in a SCSS variable is still flagged", () => {
    const findings = audit({ "src/a.scss": "$brand: #abc;" });
    expect(checks(findings, "hardcoded-color")).toHaveLength(1);
  });
});

describe("core violation detection", () => {
  const screen = {
    "src/app/screen.tsx": `
      <Stack gap="4">
        <Card className="mt-6 max-w-md" />
        <Card className="bg-zinc-900 rounded-2xl shadow-xl" />
        <div style={{ color: 'red' }} />
        <Progress style={{ '--progress': pct }} />
      </Stack>`,
    "src/components/ui/button.tsx": "export function Button() { return null }",
  };

  test("appearance overrides on call sites are flagged, layout is not", () => {
    const findings = checks(audit(screen), "appearance-override");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.snippet).toContain("bg-zinc-900");
  });

  test("layout primitives may take className freely", () => {
    const findings = audit({ "src/a.tsx": `<Stack className="bg-primary p-4" />` });
    expect(checks(findings, "appearance-override")).toEqual([]);
  });

  test.each([
    ["lucide-react", `import { ChevronDown } from "lucide-react"`],
    ["heroicons", `import { XMarkIcon } from "@heroicons/react/24/outline"`],
    ["aliased import", `import { Check as Tick } from "lucide-react"`],
  ])("icon components take colour via className by design: %s", (_l, imp) => {
    const tag = imp.match(/\{\s*\w+(?:\s+as\s+(\w+))?/)?.[1]
      ?? imp.match(/\{\s*(\w+)/)![1]!;
    const findings = audit({
      "src/a.tsx": `${imp}\nexport const A = () => <${tag} className="text-muted size-4" />`,
    });
    expect(checks(findings, "appearance-override")).toEqual([]);
  });

  test("a non-icon component from another package is still flagged", () => {
    const findings = audit({
      "src/a.tsx": `import { Card } from "@/components/ui"\nexport const A = () => <Card className="bg-surface" />`,
    });
    expect(checks(findings, "appearance-override")).toHaveLength(1);
  });

  test("inline style is an error; a CSS-var passthrough is only a warning", () => {
    const inline = checks(audit(screen), "inline-style");
    expect(inline.map((f) => f.severity).sort()).toEqual(["error", "warning"]);
  });

  test("library components without stories are flagged", () => {
    expect(checks(audit(screen), "missing-story")).toHaveLength(1);
  });

  test("token files may contain raw values", () => {
    const findings = audit({ "src/tokens.css": ":root { --brand: #1a56db; }" });
    expect(checks(findings, "hardcoded-color")).toEqual([]);
  });

  test("--skip suppresses a check", () => {
    const findings = audit(screen, ["--skip", "missing-story,raw-palette"]);
    expect(checks(findings, "missing-story")).toEqual([]);
    expect(checks(findings, "raw-palette")).toEqual([]);
  });
});

describe("CI contract", () => {
  test("exits non-zero when errors are present, zero when clean", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-ui-exit-"));
    tempDirs.push(root);

    writeFileSync(join(root, "clean.tsx"), `<div className="bg-primary" />`);
    expect(Bun.spawnSync(["bun", SCRIPT, root]).exitCode).toBe(0);

    writeFileSync(join(root, "dirty.tsx"), `<div className="bg-[#fff]" />`);
    expect(Bun.spawnSync(["bun", SCRIPT, root]).exitCode).toBe(1);
  });

  test("warnings alone do not fail the build", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-ui-warn-"));
    tempDirs.push(root);
    writeFileSync(join(root, "a.tsx"), `<Card className="bg-zinc-900" />`);
    const proc = Bun.spawnSync(["bun", SCRIPT, root]);
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("0 errors");
  });
});
