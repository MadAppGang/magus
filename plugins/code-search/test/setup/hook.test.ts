import { expect, test } from "bun:test";
import { readSettings, routed, settings, site, hook, SKILL, status } from "./support";

function context(output: ReturnType<typeof hook>): string {
  expect(output.exitCode).toBe(0);
  const payload = JSON.parse(output.stdout);
  const text = payload.hookSpecificOutput?.additionalContext ?? payload.additionalContext;
  expect(typeof text).toBe("string");
  return text as string;
}

function silent(output: ReturnType<typeof hook>): void {
  expect(output.exitCode).toBe(0);
  expect(output.stdout).toBe("");
}

test("same project: ready, dismissed and none are silent; unconfigured offers setup", () => {
  const s = site();
  routed(s);
  expect(status(s).headline).toBe("ready");
  silent(hook(s));

  const document = readSettings(s.projectSettings);
  document["code-search"].setup = "dismissed";
  settings(s.projectSettings, document);
  expect(status(s).headline).toBe("dismissed");
  silent(hook(s));

  document["code-search"] = { engine: false, setup: "active" };
  settings(s.projectSettings, document);
  expect(status(s).headline).toBe("none");
  silent(hook(s));

  delete document["code-search"];
  settings(s.projectSettings, document);
  expect(status(s).headline).toBe("unconfigured");
  const first = context(hook(s));
  expect(first).toContain("unconfigured");
  expect(first).toContain("Before you first search or investigate this codebase by any means");
  expect(first).toContain("Grep, Glob, `code_search`");
  expect(first).toContain("AskUserQuestion");
  expect(first).toContain("Set up now");
  expect(first).toContain("Not now");
  expect(first).toContain("Ignore for this project");
  expect(first).toContain(SKILL);
  expect(first).toContain(s.project);
  expect(first).toContain("If the task needs no search of this codebase at all, do not ask.");
});
