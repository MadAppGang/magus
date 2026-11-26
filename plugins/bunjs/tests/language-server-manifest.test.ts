import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const manifestPath = join(repoRoot, "plugins", "bunjs", ".claude-plugin", "plugin.json");

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as {
    lspServers: Record<string, { command: string; args: string[]; extensionToLanguage: Record<string, string> }>;
    requires: { bin: { name: string }[] };
  };
}

test("[REQ-1/REQ-M1] bunjs exposes one wrapper-backed server for all eight TS and JS extensions", () => {
  const { lspServers } = readManifest();

  expect(Object.keys(lspServers)).toEqual(["typescript"]);
  expect(lspServers.typescript.command).toBe("sh");
  expect(lspServers.typescript.args).toEqual([
    "${CLAUDE_PLUGIN_ROOT}/language-server/bin/launch.sh",
    "typescript-language-server",
    "--stdio",
  ]);
  expect(lspServers.typescript.extensionToLanguage).toEqual({
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mts": "typescript",
    ".cts": "typescript",
    ".mjs": "javascript",
    ".cjs": "javascript",
  });
});

test("[REQ-4/REQ-M4] bunjs lists only Bun as a required binary", () => {
  const { requires } = readManifest();

  expect(requires.bin.map(({ name }) => name)).toEqual(["bun"]);
});
