import { expect } from "claude-code/testing";
import { test } from "./kit";
import { TEAM_TOOL, harness, start } from "./fake-claudish";
import { mountBand } from "./ui";

const note = "Run-status colours: herdr reports no terminal theme, so TERM_THEME decides (else dark).";
for (const [name, env, count] of [
  ["CT-NOTE fallback in herdr", { HERDR_ENV: "1", HERDR_PANE_ID: "w9:p8R", TERM_THEME: "light" }, 1],
  ["CT-STALE inherited tmux pane without a client", { HERDR_ENV: "1", HERDR_PANE_ID: "w9:p8R", TMUX_PANE: "%5" }, 1],
  ["CT-NOHERDR fallback without herdr", { TERM_THEME: "light" }, 0],
] as const) {
  test(`[REQ-9] ${name}: toast only at the first eligible call`, async ($, on) => {
    const h = harness(on, { env });
    const notices = () => h.toasts.filter(text => text === note);
    await start($, "terminal");
    await h.clock.advance(1000);
    await mountBand($, "terminal");
    expect(notices()).toHaveLength(0);
    await $.tool.call({ tool: TEAM_TOOL, mode: "run", path: "first" });
    expect(notices()).toHaveLength(count);
    await mountBand($, "terminal");
    await $.tool.call({ tool: TEAM_TOOL, mode: "run", path: "second" });
    expect(notices()).toHaveLength(count);
  });
}
