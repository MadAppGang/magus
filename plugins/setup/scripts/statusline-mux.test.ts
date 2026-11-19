import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const script = join(import.meta.dir, "statusline.sh");
const chipNote = "Under herdr the worktree chip cannot follow /color; it comes from CLAUDE_WT_COLOUR.";
const longNote = "Under herdr the status line cannot read a terminal theme or follow /color; the theme comes from TERM_THEME or COLORFGBG (else dark) and the worktree chip from CLAUDE_WT_COLOUR.";

for (const [name, nesting, herdr, theme, note] of [
  ["SL-NEAR herdr-in-tmux ignores the outer pane colour", "herdr-nearer", true, "tmux", chipNote],
  ["tmux-in-herdr uses the nearer tmux pane", "tmux-nearer", true, "tmux", null],
  ["an unrelated process tree falls back", "unrelated", true, "tmux", chipNote],
  ["herdr only uses the environment", "none", true, "env", longNote],
  ["plain tmux uses its pane colour", "tmux-nearer", false, "tmux", null],
] as const) {
  test(`[REQ-8] ${name}; --sources returns with stdin open`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-mux-"));
    try {
      const ps = Bun.which("ps")!;
      writeFileSync(join(dir, "ps"), `#!/bin/sh
"$QA_REAL_PS" "$@" | awk -v p="$QA_HERDR_PID" -v near="$QA_NESTING" '
  near == "herdr-nearer" && $1 == p { $3 = "herdr" }
  { print }
'
`, { mode: 0o755 });
      writeFileSync(join(dir, "tmux"), `#!/bin/sh
case "$*" in
  *pane_pid*) printf '%s\\n' "$QA_PANE_PID" ;;
  *list-clients*) printf '100 light\\n' ;;
  *@cc_colour*) printf 'red\\n' ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
      const proc = Bun.spawn(["bash", "-c", 'export QA_HERDR_PID=$$; bash "$1" --sources; exit $?', "_", script], {
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
        env: { PATH: dir + delimiter + process.env.PATH, HOME: dir, TERM_THEME: "dark",
          CLAUDE_WT_COLOUR: "blue", QA_NESTING: nesting, QA_REAL_PS: ps,
          QA_PANE_PID: String(nesting === "unrelated" ? 99999999 : process.pid),
          ...(nesting === "none" ? {} : { TMUX: "qa", TMUX_PANE: "%5" }),
          ...(herdr ? { HERDR_ENV: "1", HERDR_PANE_ID: "w9:p8R" } : {}) },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const code = await Promise.race([proc.exited, new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), 2000);
        })]);
        expect(code).toBe(0);
        const lines = (await new Response(proc.stdout).text()).trim().split("\n");
        expect(lines.find(line => line.startsWith("theme: "))).toMatch(theme === "tmux" ? /tmux/i : /TERM_THEME/);
        expect(lines.filter(line => line.startsWith("Under herdr"))).toEqual(note ? [note] : []);
        expect(lines.find(line => line.startsWith("chip: "))).toMatch(note ? /CLAUDE_WT_COLOUR/ : /tmux|@cc_colour/i);
      } finally {
        clearTimeout(timer);
        await proc.stdin.end();
        if (proc.exitCode === null) proc.kill();
        await proc.exited;
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
