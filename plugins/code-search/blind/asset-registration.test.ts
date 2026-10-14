import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findShells } from "../test-support/grep-merge-harness";

const assets = ["grep-merge.sh", "grep-merge-body.sh"].map((file) => resolve(import.meta.dir, "../assets", file));
for (const asset of assets) {
  test(`R12.2 P1 ${asset.split("/").at(-1)} parses in each installed bash and zsh`, () => {
    for (const shell of findShells()) {
      const result = spawnSync(shell.path, ["-n", asset], { encoding: "utf8" });
      expect({ rc: result.status, stderr: result.stderr }).toEqual({ rc: 0, stderr: "" });
    }
  });
  test(`R12.2 P1 ${asset.split("/").at(-1)} has only keyword function definitions and short lines`, () => {
    const text = readFileSync(asset, "utf8");
    expect(text).not.toMatch(/\b(?:exit)\b/u);
    expect(text).not.toMatch(/^[ \t]*(?:function[ \t]+)?[a-zA-Z_][a-zA-Z_0-9]*\s*\(\s*\)\s*\{/mu);
    expect(text.split("\n").every((line) => line.length <= 120)).toBe(true);
    expect(text).toContain("__cs_gm_done");
  });
}
test("R12.2 P1 main ends in the alias-restore compound; body ends in colon", () => {
  const main = readFileSync(assets[0]!, "utf8").trimEnd();
  const body = readFileSync(assets[1]!, "utf8").trimEnd();
  expect(main.endsWith(`if [[ -n \${__cs_gm_ra-} ]]; then
  \\builtin unset __cs_gm_ra
  if [[ -n \${ZSH_VERSION-} ]]; then \\builtin setopt aliases; else \\builtin shopt -s expand_aliases; fi
else
  \\builtin unset __cs_gm_ra
fi`)).toBe(true);
  expect(body.endsWith(":")).toBe(true);
  expect(body).toContain("__cs_cc_grep");
  expect(main).toContain("builtin . \"$__cs_gm_b\"");
});

test("R12.9 H1 all three grep hooks register the exact silent launcher and timeout", () => {
  const config = JSON.parse(readFileSync(resolve(import.meta.dir, "../hooks/hooks.json"), "utf8"));
  const table = [
    ["SessionStart", "startup|resume|clear|compact", "grep-merge-env.ts"],
    ["PostToolUse", "^Grep$", "grep-tool-merge.ts"],
    ["PreToolUse", "^Bash$", "redirect-search-to-facade.ts"],
  ] as const;
  for (const [event, matcher, file] of table) {
    const expected = `command -v bun >/dev/null 2>&1 && CODE_SEARCH_SESSION_PID=$PPID bun --env-file=/dev/null --config=/dev/null "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}" 2>/dev/null || true`;
    const matching = config.hooks[event].filter((group: { matcher: string; hooks: { command: string; timeout: number }[] }) =>
      group.matcher === matcher && group.hooks.some((h) => h.command === expected && h.timeout === 5));
    expect(matching).toHaveLength(1);
  }
});
