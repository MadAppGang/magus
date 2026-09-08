import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "plan-mode-protocol.ts");

// The hook is the channel measured to reach the model (DPM-1), so its text is the
// contract: these pin what a fresh run and a resumed run are told, and that the two
// never overlap.

function run(prompt: string, cwd: string) {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd }),
    encoding: "utf-8",
    timeout: 20_000,
  });
  return { status: r.status, stdout: r.stdout };
}

function context(stdout: string): string {
  return (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;
}

describe("plan-mode-protocol", () => {
  test("a fresh /dev:dev gets the plan-mode protocol, the footer template, and a marker", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-pmp-"));
    try {
      const r = run("/dev:dev add rate limiting", cwd);
      expect(r.status).toBe(0);
      const text = context(r.stdout);
      expect(text).toContain("<dev-plan-mode-protocol>");
      expect(text).toContain("EnterPlanMode");
      // The footer is part of every branch, and the adopt branch says not-created.
      expect(text).toContain("<dev-flow>");
      expect(text).toContain("session: not-created");
      expect(text).toContain("showClearContextOnPlanAccept");
      expect(text).not.toContain("<dev-resume-invocation>");
      expect(existsSync(join(cwd, ".claude/.coaching/dev-run.json"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("/dev:dev --resume gets the resume block and NOT the plan-mode protocol", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-pmp-"));
    try {
      for (const prompt of ["/dev:dev --resume", "/dev:dev --resume dev-feature-x-1"]) {
        const r = run(prompt, cwd);
        expect(r.status).toBe(0);
        const text = context(r.stdout);
        expect(text).toContain("<dev-resume-invocation>");
        expect(text).toContain("<resume_protocol>");
        expect(text).not.toContain("<dev-plan-mode-protocol>");
        expect(text).not.toContain("EnterPlanMode");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("the word --resume inside an ordinary request is NOT a resume", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-pmp-"));
    try {
      // The flag must lead the arguments. The first revision matched `--resume` anywhere
      // and misrouted "add a --resume flag to the uploader" into the resume protocol.
      const r = run("/dev:dev add a --resume flag to the uploader", cwd);
      expect(r.status).toBe(0);
      const text = context(r.stdout);
      expect(text).toContain("<dev-plan-mode-protocol>");
      expect(text).not.toContain("<dev-resume-invocation>");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a resume still writes the run marker — the resumed run may re-enter plan mode", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-pmp-"));
    try {
      const r = run("/dev:dev --resume dev-feature-x-1", cwd);
      expect(r.status).toBe(0);
      expect(existsSync(join(cwd, ".claude/.coaching/dev-run.json"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("prompts that only mention the command are ignored", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-pmp-"));
    try {
      for (const prompt of ["/dev:dever go", "what does /dev:devx do", "hello"]) {
        const r = run(prompt, cwd);
        expect(r.status).toBe(0);
        expect(r.stdout).toBe("");
      }
      expect(existsSync(join(cwd, ".claude/.coaching/dev-run.json"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
