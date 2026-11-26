import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const hooksRoot = join(repoRoot, "plugins", "bunjs", "hooks");
const binary = "typescript-language-server";
const installCommand = /\bnpm install -g typescript-language-server typescript(?![\w.-])/;
const wrapperManifest = JSON.stringify({
  lspServers: {
    typescript: {
      command: "sh",
      args: ["${CLAUDE_PLUGIN_ROOT}/language-server/bin/launch.sh", binary, "--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
    },
  },
});

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command?: string }[];
}

function registeredArgv(): string[] {
  const { hooks } = JSON.parse(readFileSync(join(hooksRoot, "hooks.json"), "utf8")) as {
    hooks: Record<string, HookGroup[]>;
  };
  const registrations = Object.entries(hooks).flatMap(([event, groups]) =>
    groups.flatMap(({ matcher, hooks }) =>
      hooks.filter(({ command }) => command?.includes("/hooks/conflict-check.ts"))
        .map((hook) => ({ event, matcher, ...hook })),
    ),
  );

  expect(registrations).toHaveLength(1);
  const [{ event, matcher, type, command }] = registrations;
  expect({ event, matcher, type }).toEqual({ event: "SessionStart", matcher: "startup", type: "command" });
  const invocation = /"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/conflict-check\.ts"\s+([^|\n]+?)\s+\|\|\s+true\s*$/.exec(command ?? "");
  if (!invocation) throw new Error("Expected a conflict-check command ending in || true: " + command);
  const argv = invocation[1].split(/\s+/);
  expect(argv).toEqual(["bunjs", "typescript-lsp", "lsp"]);
  return argv;
}

function snapshot(root: string, subdir = ""): [string, string][] {
  const entries = readdirSync(join(root, subdir), { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return entries.flatMap((entry): [string, string][] => {
    const path = join(subdir, entry.name);
    if (entry.isDirectory()) return [[path, "directory"], ...snapshot(root, path)];
    const state = entry.isFile() ? "file:" + readFileSync(join(root, path)).toString("base64") : "other";
    return [[path, state]];
  });
}

function runHook(options: {
  enabled?: string[];
  manifest?: string;
  executable?: string;
  verifyReadOnly?: boolean;
} = {}): string {
  const scratch = mkdtempSync(join(tmpdir(), "bunjs-language-server-hook-"));
  try {
    const home = join(scratch, "home");
    const project = join(scratch, "project");
    const pluginRoot = join(scratch, "plugin");
    const bin = join(scratch, "bin");
    for (const dir of [home, project, pluginRoot, bin]) mkdirSync(dir);

    if (options.enabled) {
      const settingsDir = join(project, ".claude");
      mkdirSync(settingsDir);
      const enabledPlugins = Object.fromEntries(options.enabled.map((id) => [id, true]));
      writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ enabledPlugins }));
    }
    if (options.manifest !== undefined) {
      const manifestDir = join(pluginRoot, ".claude-plugin");
      mkdirSync(manifestDir);
      writeFileSync(join(manifestDir, "plugin.json"), options.manifest);
    }
    if (options.executable) {
      writeFileSync(join(bin, options.executable), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }

    const env: Record<string, string> = {
      HOME: home,
      PATH: bin,
      TMPDIR: scratch,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    };
    const before = options.verifyReadOnly ? snapshot(scratch) : undefined;
    const argv = registeredArgv();
    const child = Bun.spawnSync(
      [process.execPath, "--no-env-file", "--config=/dev/null", join(hooksRoot, "conflict-check.ts"), ...argv],
      {
        cwd: home,
        env,
        stdin: Buffer.from(JSON.stringify({ cwd: project })),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      },
    );

    const stdout = child.stdout.toString();
    expect(child.exitCode, child.stderr.toString() || stdout).toBe(0);
    if (before) expect(snapshot(scratch)).toEqual(before);
    return stdout;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function singleMessage(stdout: string): string {
  // Parsing stdout as a whole rejects a second JSON object or stray logging.
  const payload = JSON.parse(stdout);
  expect(typeof payload?.systemMessage).toBe("string");
  const message: string = payload.systemMessage;
  expect(payload).toEqual({
    systemMessage: message,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message },
  });
  return message;
}

function expectMissingServer(message: string): void {
  expect(message).toMatch(/^bunjs:/);
  expect(message).toMatch(installCommand);
  const warning = message.replace(installCommand, "");
  expect(warning).toContain(binary);
  expect(warning).toMatch(/\b(?:not (?:found )?(?:on|in)|missing from) (?:the )?[$\x60]*PATH\b/);
  expect(message).not.toMatch(/\b(?:(?:the )?bunjs plugin|the plugin|plugin bunjs|bunjs)\s+(?:is (?:broken|unusable)|(?:cannot|can't|will not|won't) (?:run|work))\b/i);
}

function expectConflictLabel(message: string): void {
  expect(message).toMatch(/^bunjs:/);
  expect(message).not.toMatch(/^\s*lsp:|(?<![\w-])lsp may not run\b/im);
}

test("[REQ-21] bunjs registers the conflict-check startup command once with the TypeScript conflict list", () => {
  registeredArgv();
});

test("[REQ-6/REQ-C1 REQ-9/REQ-C4 REQ-23] bunjs reports both conflicts with scoped uninstall commands under the bunjs label", () => {
  const message = singleMessage(runHook({ enabled: ["typescript-lsp@x", "lsp@magus"] }));

  expectConflictLabel(message);
  expect(message).toMatch(/\bclaude plugin uninstall typescript-lsp@x --scope project(?![\w-])/);
  expect(message).toMatch(/\bclaude plugin uninstall lsp@magus --scope project(?![\w-])/);
});

test("[REQ-7/REQ-C2 REQ-23] bunjs stays silent when only gopls-lsp is enabled", () => {
  expect(runHook({ enabled: ["gopls-lsp@x"] })).toBe("");
});

test("[REQ-12/REQ-S2 REQ-17/REQ-S7 REQ-23] the missing TypeScript server gets a PATH warning and the npm install command", () => {
  const message = singleMessage(runHook({ manifest: wrapperManifest }));

  expectMissingServer(message);
});

test("[REQ-13/REQ-S3 REQ-23] bunjs stays silent when the TypeScript server is executable on PATH", () => {
  expect(runHook({ manifest: wrapperManifest, executable: binary })).toBe("");
});

test("[REQ-16/REQ-S6 REQ-23] bunjs emits one combined notice and leaves the test tree unchanged", () => {
  const stdout = runHook({
    enabled: ["typescript-lsp@x"],
    manifest: wrapperManifest,
    verifyReadOnly: true,
  });

  const message = singleMessage(stdout);
  expect(message).toMatch(/\bclaude plugin uninstall typescript-lsp@x --scope project(?![\w-])/);
  expectMissingServer(message);
});
