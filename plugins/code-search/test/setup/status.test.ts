import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  SETUP, assertNotExecuted, cli, codeSearch, fakeExecutable,
  routed, settings, site, status,
} from "./support";

describe("status: headline and every finding", () => {
  test("unconfigured reports its own problem, exit 0", () => {
    const s = site();
    const result = status(s);
    expect(result.headline).toBe("unconfigured");
    expect(result.codes).toContain("unconfigured");
  });

  test("dismissed has precedence, but still lists what undismissing would expose", () => {
    const s = site();
    codeSearch(s.projectSettings, { setup: "dismissed" });
    const result = status(s);
    expect(result.headline).toBe("dismissed");
    expect(result.codes).toContain("unconfigured");
  });

  test("explicit none is terminal", () => {
    const s = site();
    codeSearch(s.projectSettings, { setup: "active", engine: false });
    const result = status(s);
    expect(result.headline).toBe("none");
    expect(result.codes).not.toContain("engine_missing");
    expect(result.codes).not.toContain("index_missing");
  });

  test("none still lists an invalid lower layer", () => {
    const s = site();
    writeFileSync(s.userSettings, "{bad json");
    codeSearch(s.projectSettings, { setup: "active", engine: false });
    const result = status(s);
    expect(result.headline).toBe("none");
    expect(result.codes).toContain("settings_invalid");
  });

  test("a malformed layer wins over a missing engine without hiding it", () => {
    const s = site();
    writeFileSync(s.localSettings, "{unparseable");
    const result = status(s);
    expect(result.headline).toBe("settings_invalid");
    expect(result.codes).toContain("settings_invalid");
    expect(result.codes).toContain("unconfigured");
  });

  test("unknown id or absent engine block is engine_unknown; never near-matched", () => {
    const s = site();
    codeSearch(s.projectSettings, { engine: "mnemexx", engines: { mnemexx: { command: "missing" } } });
    expect(status(s).headline).toBe("engine_unknown");
    codeSearch(s.projectSettings, { engine: "mnemex", engines: {} });
    const result = status(s);
    expect(result.headline).toBe("engine_unknown");
    expect(result.codes).toContain("engine_unknown");
  });

  test("engine_missing precedes index_missing", () => {
    const s = site();
    codeSearch(s.projectSettings, {
      engine: "codegraph", engines: { codegraph: { command: "does-not-exist-here", args: [] } },
    });
    const result = status(s);
    expect(result.headline).toBe("engine_missing");
    expect(result.codes).toContain("engine_missing");
    expect(result.codes).toContain("index_missing");
  });

  for (const [engine, relative] of [
    ["mnemex", ".mnemex/index.db"],
    ["codegraph", ".codegraph/codegraph.db"],
    ["graphify", "graphify-out/graph.json"],
  ] as const) {
    test(`${engine}: only its documented marker resolves index_missing`, () => {
      const s = site();
      routed(s, engine, false);
      expect(status(s).headline).toBe("index_missing");
      const marker = join(s.project, relative);
      mkdirSync(dirname(marker), { recursive: true });
      writeFileSync(marker, "indexed");
      const result = status(s);
      expect(result.headline).toBe("ready");
      expect(result.codes).not.toContain("index_missing");
    });
  }

  test("serena has no project marker and a routed installation is ready", () => {
    const s = site();
    routed(s, "serena", false);
    const result = status(s);
    expect(result.headline).toBe("ready");
    expect(result.codes).not.toContain("index_missing");
  });

  test("a nonexistent project is nothing measured, exit 2", () => {
    const s = site();
    rmSync(s.project, { recursive: true });
    const result = cli(s, ["status"]);
    expect(result.exitCode).toBe(2);
    expect(result.json.ok).toBe(false);
    expect(result.json.failure.code).toBe("project_missing");
  });
});

test("fast status executes no PATH tools and sends no proxy request", async () => {
  const s = site();
  routed(s);
  for (const name of ["npm", "uv", "claude", "mnemex", "rg", "bun"]) {
    // Bun itself must remain the absolute executable used by the harness. The stub
    // is only for lookups done by the setup process.
    if (name !== "rg") fakeExecutable(s, name);
  }
  const trap = fakeExecutable(s, "trap");
  expect(spawnSync(trap, [], { cwd: s.project, env: s.env }).status).toBe(0);
  expect(readFileSync(s.marker, "utf8")).toContain("trap");
  rmSync(s.marker);

  let requests = 0;
  const proxy = createServer((_req, res) => {
    requests++;
    res.writeHead(599).end();
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("proxy did not bind");
    const url = `http://127.0.0.1:${address.port}`;
    const env = {
      ...s.env, HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url,
      http_proxy: url, https_proxy: url, NO_PROXY: "", no_proxy: "",
    };
    const child = spawn(process.execPath,
      ["--env-file=/dev/null", "--config=/dev/null", SETUP, "status", "--json", "--project", s.project],
      { cwd: s.project, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    if (!child.stdout || !child.stderr) throw new Error("status did not open output pipes");
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`status hung: ${stderr}`)); }, 15_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (exitCode) => { clearTimeout(timer); resolve(exitCode); });
    });
    expect(code).toBe(0);
    const report = JSON.parse(stdout).data.report;
    expect((report.state ?? report).headline).toBe("ready");
    assertNotExecuted(s);
    expect(requests).toBe(0);
  } finally {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
