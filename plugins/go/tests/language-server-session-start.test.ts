import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const hooksRoot = join(repoRoot, "plugins", "go", "hooks");
const binary = "gopls";
const installCommand = /\bgo install golang\.org\/x\/tools\/gopls@latest(?![\w.-])/;
const wrapperManifest = JSON.stringify({
  lspServers: {
    gopls: {
      command: "sh",
      args: ["${CLAUDE_PLUGIN_ROOT}/language-server/bin/launch.sh", binary],
      extensionToLanguage: { ".go": "go" },
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
  expect(argv).toEqual(["go", "gopls-lsp", "lsp"]);
  return argv;
}

function runHook(options: {
  enabled?: string[];
  manifest?: string;
  executable?: string;
  argv?: string[];
  useShippedManifest?: boolean;
} = {}): string {
  const scratch = mkdtempSync(join(tmpdir(), "go-language-server-hook-"));
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
    };
    if (!options.useShippedManifest) env.CLAUDE_PLUGIN_ROOT = pluginRoot;
    const argv = options.argv ?? registeredArgv();
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
  expect(message).toMatch(/^go:/);
  expect(message).toMatch(installCommand);
  const warning = message.replace(installCommand, "");
  expect(warning).toContain(binary);
  expect(warning).toMatch(/\b(?:not (?:found )?(?:on|in)|missing from) (?:the )?[$\x60]*PATH\b/);
  expect(message).not.toMatch(/\b(?:(?:the )?go plugin|the plugin|plugin go|go)\s+(?:is (?:broken|unusable)|(?:cannot|can't|will not|won't) (?:run|work))\b/i);
}

function expectConflictLabel(message: string): void {
  expect(message).toMatch(/^go:/);
  expect(message).not.toMatch(/^\s*lsp:|(?<![\w-])lsp may not run\b/im);
}

test("[REQ-21] go registers the conflict-check startup command once with the Go conflict list", () => {
  registeredArgv();
});

test("[REQ-8/REQ-C3 REQ-23] go stays silent when only typescript-lsp is enabled", () => {
  expect(runHook({ enabled: ["typescript-lsp@x"] })).toBe("");
});

test("[REQ-8/REQ-C3 REQ-9/REQ-C4 REQ-23] go reports lsp under the go label with a scoped uninstall command", () => {
  const message = singleMessage(runHook({ enabled: ["lsp@magus"] }));

  expectConflictLabel(message);
  expect(message).toMatch(/\bclaude plugin uninstall lsp@magus --scope project(?![\w-])/);
});

test.each([
  ["no arguments", []],
  ["the label but no names", ["go"]],
] as [string, string[]][])(
  "[REQ-10/REQ-C5 REQ-23] go stays silent with %s even when conflict candidates are enabled",
  (_name, argv) => {
    const stdout = runHook({ enabled: ["gopls-lsp@x", "lsp@magus"], argv });

    expect(stdout).toBe("");
  },
);

test("[REQ-11/REQ-S1 REQ-17/REQ-S7 REQ-23] missing gopls gets a PATH warning and the Go install command", () => {
  const message = singleMessage(runHook({ manifest: wrapperManifest }));

  expectMissingServer(message);
});

test("[REQ-13/REQ-S3 REQ-23] go stays silent when gopls is executable on PATH", () => {
  expect(runHook({ manifest: wrapperManifest, executable: binary })).toBe("");
});

test("[REQ-14/REQ-S4 REQ-23] a missing unknown direct launcher is named without an install line", () => {
  const unlisted = "qa-unlisted-language-server";
  const manifest = JSON.stringify({
    lspServers: {
      unknown: { command: unlisted, args: ["--probe", binary], extensionToLanguage: { ".go": "go" } },
    },
  });

  const message = singleMessage(runHook({ manifest, executable: binary }));

  expect(message).toContain(unlisted);
  expect(message).not.toMatch(
    /\b(?:go|npm|bun|brew|apt(?:-get)?|dnf|pipx?)\s+(?:\S+\s+)*install\b|^\s*(?:[-*]\s*)?(?:to\s+)?install\b/im,
  );
});

test("[REQ-15/REQ-S5 REQ-23] go stays silent when the override root has no manifest", () => {
  expect(runHook()).toBe("");
});

test("[REQ-15/REQ-S5 REQ-23] go stays silent when the override manifest is malformed", () => {
  expect(runHook({ manifest: "{ invalid json" })).toBe("");
});

test("[REQ-23 REQ-24] go discovers its shipped manifest when the plugin root is unset", () => {
  const message = singleMessage(runHook({ useShippedManifest: true }));

  expectMissingServer(message);
});
