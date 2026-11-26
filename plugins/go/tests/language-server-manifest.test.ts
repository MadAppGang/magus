import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const goRoot = join(repoRoot, "plugins", "go");
const bunjsRoot = join(repoRoot, "plugins", "bunjs");
const pluginRootVariable = "${CLAUDE_PLUGIN_ROOT}";

interface Manifest {
  lspServers: Record<string, {
    command: string;
    args: string[];
    extensionToLanguage: Record<string, string>;
  }>;
  requires: { bin: { name: string }[] };
}

function readManifest(pluginRoot: string): Manifest {
  return JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
}

test("[REQ-2/REQ-M2] go exposes only gopls through the wrapper for .go files", () => {
  const { lspServers } = readManifest(goRoot);

  expect(Object.keys(lspServers)).toEqual(["gopls"]);
  expect(lspServers.gopls.command).toBe("sh");
  expect(lspServers.gopls.args).toEqual([pluginRootVariable + "/language-server/bin/launch.sh", "gopls"]);
  expect(lspServers.gopls.extensionToLanguage).toEqual({ ".go": "go" });
});

test("[REQ-4/REQ-M4] go lists only Bun as a required binary", () => {
  const { requires } = readManifest(goRoot);

  expect(requires.bin.map(({ name }) => name)).toEqual(["bun"]);
});

test("[REQ-3/REQ-M3] go and bunjs claim no common file extension", () => {
  const claimedBy = (pluginRoot: string) =>
    Object.values(readManifest(pluginRoot).lspServers).flatMap(({ extensionToLanguage }) =>
      Object.keys(extensionToLanguage),
    );

  const bunjsExtensions = new Set(claimedBy(bunjsRoot));
  const shared = claimedBy(goRoot).filter((extension) => bunjsExtensions.has(extension));

  expect(shared).toEqual([]);
});

function filesIn(root: string, subdir = ""): string[] {
  return readdirSync(join(root, subdir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(subdir, entry.name);
    return entry.isDirectory() ? filesIn(root, relativePath) : [relativePath];
  });
}

test("[REQ-5/REQ-M5] both declared launchers exist and the language-server files match byte for byte", () => {
  for (const [pluginRoot, server] of [[goRoot, "gopls"], [bunjsRoot, "typescript"]] as const) {
    const declaredPath = readManifest(pluginRoot).lspServers[server].args[0];
    expect(declaredPath.startsWith(pluginRootVariable + "/")).toBe(true);
    expect(statSync(join(pluginRoot, declaredPath.slice(pluginRootVariable.length + 1))).isFile()).toBe(true);
  }

  const goServerRoot = join(goRoot, "language-server");
  const bunjsServerRoot = join(bunjsRoot, "language-server");
  const shippedPaths = filesIn(goServerRoot).sort();

  expect(filesIn(bunjsServerRoot).sort()).toEqual(shippedPaths);
  for (const path of shippedPaths) {
    const goBytes = readFileSync(join(goServerRoot, path));
    const bunjsBytes = readFileSync(join(bunjsServerRoot, path));
    expect(bunjsBytes.equals(goBytes), path).toBe(true);
  }
});

test("[REQ-22] the go and bunjs conflict-check hooks ship identical bytes", () => {
  const goHook = readFileSync(join(goRoot, "hooks", "conflict-check.ts"));
  const bunjsHook = readFileSync(join(bunjsRoot, "hooks", "conflict-check.ts"));

  expect(bunjsHook.equals(goHook)).toBe(true);
});
