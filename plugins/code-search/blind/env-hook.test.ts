import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { envLineBytes, holdsSourceLine, shelloptsRefuse, sourceLineOf } from "../hooks/grep-merge-env";

const entry = resolve(import.meta.dir, "../hooks/grep-merge-env.ts");
const asset = resolve(import.meta.dir, "../assets/grep-merge.sh");
const line = envLineBytes(asset)!;
const expected = (p: string) => `\ncase $- in *[vxr]*) ;; *) if [[ -r '${p}' && ! -o sourcetrace ]]; then builtin . '${p}'; fi ;; esac; :\n`;

for (const path of ["/a/b/assets/grep-merge.sh", "/a b/$x/grep-merge.sh"]) {
  test(`R12.7 P7 envLineBytes emits exactly one guarded line for ${path}`, () => {
    expect(envLineBytes(path)).toBe(expected(path));
    expect(sourceLineOf(path)).toBe(expected(path).slice(1, -1));
  });
}
for (const path of ["a/relative", "/a'b", "/a\nb", "/a\tb", "/a\x7fb", "/a\0b"]) {
  test(`R12.7 P7 envLineBytes rejects unsafe path ${JSON.stringify(path)}`, () => {
    expect(envLineBytes(path)).toBeUndefined();
    expect(sourceLineOf(path)).toBeUndefined();
  });
}
for (const [input, output] of [[undefined, false], ["", false], ["braceexpand:hashall", false], ["braceexpand:verbose", true], ["xtrace", true], ["xtracex:verbosely", false]] as const) {
  test(`R12.7 P7 SHELLOPTS ${String(input)} is ${output ? "refused" : "accepted"}`, () => {
    expect(shelloptsRefuse(input)).toBe(output);
  });
}
test("R12.7 P7 source line must occupy an entire line", () => {
  const src = sourceLineOf(asset)!;
  expect(holdsSourceLine(`before\n${src}\nafter`, src)).toBe(true);
  expect(holdsSourceLine(`# ${src}\n${src} suffix`, src)).toBe(false);
});

type Result = { rc: number; stdout: string; stderr: string };
function invoke(project: string, envFile: string | undefined, extra: Record<string, string> = {}): Promise<Result> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(project, "home"),
    CLAUDE_PROJECT_DIR: project, CODE_SEARCH_MERGE_LOG: join(project, "merge.log"),
    ...extra,
  };
  if (envFile !== undefined) env.CLAUDE_ENV_FILE = envFile;
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", entry], {
      env, cwd: project, stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ rc: code ?? -1,
      stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });
}
function project(settings: unknown = { "code-search": { engine: "mnemex", engines: { mnemex: { command: "mnemex" } }, grep: { route: true } } }) {
  const root = mkdtempSync(join(tmpdir(), "csgm-hook-"));
  mkdirSync(join(root, "home", ".claude"), { recursive: true });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(settings));
  return { root, envFile: join(root, "session-env.sh"), dispose: () => rmSync(root, { force: true, recursive: true }) };
}

for (const [name, original, mode] of [
  ["create", undefined, 0],
  ["append after unterminated foreign bytes", "export FOO=1", 0o644],
  ["preserve existing line", line + "other text", 0o644],
  ["append when line has suffix", sourceLineOf(asset)! + " suffix", 0o644],
  ["append after another asset's line", envLineBytes("/another/assets/grep-merge.sh")!, 0o644],
] as const) {
  test(`R12.7 P7 SessionStart ${name} and preserves bytes/mode`, async () => {
    const p = project();
    try {
      if (original !== undefined) { writeFileSync(p.envFile, original); chmodSync(p.envFile, mode); }
      const old = original === undefined ? undefined : statSync(p.envFile).mtimeMs;
      const result = await invoke(p.root, p.envFile);
      expect(result).toEqual({ rc: 0, stdout: "", stderr: "" });
      const identical = original !== undefined && original.split("\n").includes(sourceLineOf(asset)!);
      expect(readFileSync(p.envFile, "utf8")).toBe(identical ? original : (original ?? "") + line);
      expect(statSync(p.envFile).mode & 0o777).toBe(original === undefined ? 0o600 : mode);
      if (identical) expect(statSync(p.envFile).mtimeMs).toBe(old!);
    } finally { p.dispose(); }
  });
}
test("R12.7 P7 two SessionStart runs append once", async () => {
  const p = project();
  try {
    expect(await invoke(p.root, p.envFile)).toEqual({ rc: 0, stdout: "", stderr: "" });
    const first = statSync(p.envFile).mtimeMs;
    expect(await invoke(p.root, p.envFile)).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect({ content: readFileSync(p.envFile, "utf8"), mtime: statSync(p.envFile).mtimeMs })
      .toEqual({ content: line, mtime: first });
  } finally { p.dispose(); }
});
for (const [name, settings, extra] of [
  ["route off", { "code-search": { engine: "mnemex", engines: { mnemex: { command: "mnemex" } }, grep: { route: false } } }, {}],
  ["command kill switch", { "code-search": { engine: "mnemex", engines: { mnemex: { command: "mnemex" } } } }, { CODE_SEARCH_MERGE: "0" }],
  ["settings kill switch", { "code-search": { engine: "mnemex", engines: { mnemex: { command: "mnemex" } } }, env: { CODE_SEARCH_MERGE: "0" } }, {}],
  ["no engine entry", { "code-search": { engine: "mnemex", engines: {} } }, {}],
  ["unshipped engine", { "code-search": { engine: "not-shipped", engines: { "not-shipped": { command: "not-shipped" } } } }, {}],
] as const) {
  test(`R12.7 P7 closed gate ${name} never touches env file`, async () => {
    const p = project(settings);
    try {
      writeFileSync(p.envFile, "foreign");
      const before = statSync(p.envFile).mtimeMs;
      expect(await invoke(p.root, p.envFile, extra)).toEqual({ rc: 0, stdout: "", stderr: "" });
      expect({ bytes: readFileSync(p.envFile, "utf8"), mtime: statSync(p.envFile).mtimeMs })
        .toEqual({ bytes: "foreign", mtime: before });
    } finally { p.dispose(); }
  });
}
for (const value of ["braceexpand:verbose", "xtrace"]) {
  test(`R12.7 P7 exported SHELLOPTS=${value} refuses without writing`, async () => {
    const p = project();
    try {
      expect(await invoke(p.root, p.envFile, { SHELLOPTS: value }))
        .toEqual({ rc: 0, stdout: "", stderr: "" });
      expect(existsSync(p.envFile)).toBe(false);
      expect(readFileSync(join(p.root, "merge.log"), "utf8"))
        .toBe("grep-merge-env: SHELLOPTS exports verbose or xtrace; no line written\n");
    } finally { p.dispose(); }
  });
}
test("R12.7 P7 an unwritable env target fails silently and logs the reason", async () => {
  const p = project();
  try {
    expect(await invoke(p.root, p.root)).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(p.root, "merge.log"), "utf8"))
      .toMatch(/^grep-merge-env: cannot append to .*: EISDIR\n$/);
  } finally { p.dispose(); }
});
test("R12.7 P7 absent CLAUDE_ENV_FILE exits without creating a file", async () => {
  const p = project();
  try {
    expect(await invoke(p.root, undefined)).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect(existsSync(p.envFile)).toBe(false);
  } finally { p.dispose(); }
});
