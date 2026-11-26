import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { alive, inLaunch, until, type Peer } from "./process-harness.ts";
import { frame } from "./wire.ts";

const gopls = Bun.which("gopls");
const go = Bun.which("go");
const supported = process.platform === "darwin" || process.platform === "linux";

function daemonGroups(runtimeDir: string): number[] {
  // Match only a daemon whose listen argument points into this test's runtime directory.
  const ps = Bun.spawnSync(["ps", "-axo", "pid=,pgid=,command="]);
  if (ps.exitCode !== 0) throw new Error(ps.stderr.toString());
  return ps.stdout.toString().split("\n").flatMap(line => {
    const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!row || row[1] !== row[2] || !/\bgopls\b/.test(row[3]) ||
        !/(?:^|\s)-listen(?:=|\s)/.test(row[3]) || !row[3].includes(runtimeDir + "/")) return [];
    return [Number(row[1])];
  });
}

function send(peer: Peer, method: string, params?: object, id?: number) {
  return peer.send(frame({ jsonrpc: "2.0", method, params, id }));
}

async function result(peer: Peer, id: number) {
  const deadline = performance.now() + 15_000;
  for (;;) {
    const left = deadline - performance.now();
    if (left <= 0) throw new Error("No gopls response for id " + id);
    const message = await peer.response(left);
    if (message.id !== id || "method" in message) continue;
    expect(message.error).toBeUndefined();
    return message.result;
  }
}

test.skipIf(!supported || !gopls || !go)(
  "REQ-4 REQ-6 REQ-9 real gopls isolates unsaved edits, survives client EOF, and reaps its daemon after shutdown+exit",
  () => inLaunch(async lab => {
    const rootUri = pathToFileURL(lab.cwd).href;
    const uri = pathToFileURL(join(lab.cwd, "main.go")).href;
    const runtimeDir = lab.root;
    const disk = "package sample\nfunc OnDisk() {}\n";
    rmSync(join(lab.cwd, ".git"));
    mkdirSync(join(lab.cwd, ".git"));
    writeFileSync(join(lab.cwd, "go.mod"), "module example.test/sample\n\ngo 1.18\n");
    writeFileSync(join(lab.cwd, "main.go"), disk);
    Object.assign(lab.env, { GOTOOLCHAIN: "local", GOENV: "off", GOWORK: "off", GOPROXY: "off" });

    lab.afterPeers.push(async () => {
      // The unique listen path and group leadership identify test-owned groups.
      for (const group of daemonGroups(runtimeDir)) {
        try { process.kill(-group, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        await until(() => !alive(-group), "test gopls daemon group gone", 5000);
      }
    });

    async function connect() {
      const peer = lab.start({ argv: [gopls!] });
      await send(peer, "initialize", {
        processId: null, rootUri, capabilities: {},
        workspaceFolders: [{ uri: rootUri, name: "sample" }],
      }, 1);
      expect(await result(peer, 1)).toHaveProperty("capabilities");
      await send(peer, "initialized", {});
      return peer;
    }

    async function symbols(peer: Peer, id: number) {
      await send(peer, "textDocument/documentSymbol", { textDocument: { uri } }, id);
      return (await result(peer, id)).map(({ name }: { name: string }) => name);
    }

    const a = await connect();
    const daemon = await until(() => daemonGroups(runtimeDir)[0], "first gopls daemon");
    const b = await connect();
    expect(daemonGroups(runtimeDir)).toEqual([daemon]);

    await send(a, "textDocument/didOpen", {
      textDocument: { uri, languageId: "go", version: 1, text: disk.replace("OnDisk", "OnlyInA") },
    });
    expect(await symbols(a, 2)).toContain("OnlyInA");

    await send(b, "textDocument/didOpen", { textDocument: { uri, languageId: "go", version: 1, text: disk } });
    const bNames = await symbols(b, 2);
    expect(bNames).toContain("OnDisk");
    expect(bNames).not.toContain("OnlyInA");

    a.eof();
    expect((await a.end()).code).toBe(0);
    expect(daemonGroups(runtimeDir)).toEqual([daemon]);
    expect(await symbols(b, 3)).toContain("OnDisk");

    await send(b, "shutdown", undefined, 4);
    expect(await result(b, 4)).toBeNull();
    await send(b, "exit");
    expect((await b.end()).code).toBe(0);
    await until(() => !daemonGroups(runtimeDir).includes(daemon), "idle gopls daemon gone", 75_000);
  }), 150_000,
);
