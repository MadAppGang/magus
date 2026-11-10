import { mock } from "claude-code/testing";
import type { On, FsEntry, ProcessRunResult, UiPane } from "claude-code";
import type { Engine } from "claude-code/testing";
import type { OrchestratorRecord } from "../types";
import { record, NOW, START, ROOT, PRODUCT, SELF, TRIAGE, MANAGER, CHILD } from "./testdata";
import { ENGINE_DRAWING, type Surface } from "./ui";

const ok = (stdout = "", exitCode = 0, stderr = ""): ProcessRunResult => ({
  exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false,
});
export function machine(on: On, options: { selfId?: string; mux?: "tmux" | "herdr"; placed?: boolean; herdrAtFallback?: boolean; herdrUnavailable?: boolean } = {}) {
  const effects: string[] = [];
  const clock = mock.clock(on, { now: NOW });
  const stateDir = ROOT + "/state", sessionsDir = ROOT + "/config/sessions";
  const files = new Map<string, string>(), starts = new Map<number, string>();
  const fsCalls: { op: string; path: string; at: number }[] = [];
  const commands: string[][] = [], toasts: string[] = [];
  const fills: { text: string; mode: string }[] = [];
  const opens: { id: string; title?: string; columns?: number; rows?: number }[] = [];
  const closes: string[] = [];
  const h = {
    clock, stateDir, sessionsDir, files, starts, fsCalls, commands, effects, toasts, fills, opens, closes,
    panes: [] as UiPane[], placed: options.placed !== false, fillAllowed: true,
    denyPs: false, denyReads: false, captureExit: 0, captureText: "live screen\ntrailing spaces   ",
    herdrAtFallback: options.herdrAtFallback ?? false, herdrUnavailable: options.herdrUnavailable ?? false,
    openerExits: [0], client: "/dev/tty-test\tproduct\n",
    seed(r: OrchestratorRecord) {
      const { rev, tasks, deps, blocked, holds, state, doneAt, ...i } = r;
      files.set(stateDir + "/sessions/" + r.key + ".json", JSON.stringify(i));
      files.set(stateDir + "/progress/" + r.key + ".json", JSON.stringify({ schema: 1, key: r.key, rev, updatedAt: r.updatedAt, tasks, deps, blocked, holds, state, doneAt }));
    },
    alias(id: string, key: string) { files.set(stateDir + "/by-session/" + id, key + "\n"); },
    native(r: OrchestratorRecord, status = "idle", patch: Record<string, unknown> = {}) {
      if (r.pid === null) throw new Error("Native testdata needs a pid");
      starts.set(r.pid, r.procStart ?? START);
      files.set(sessionsDir + "/" + r.pid + ".json", JSON.stringify({
        pid: r.pid, sessionId: r.sessionId, procStart: r.procStart, name: r.name,
        status, waitingFor: null, statusUpdatedAt: NOW - 180_000, updatedAt: NOW - 100,
        cwd: r.cwd, tmux: "product:@" + r.pid + ".%" + r.pid, ...patch,
      }));
    },
  };
  const env: Record<string, string> = {
    HOME: ROOT, CLAUDE_CONFIG_DIR: ROOT + "/config", ORCHESTRATOR_STATE_DIR: stateDir,
    TMUX_PANE: "%701",
    ...(options.mux === "herdr" ? { HERDR_ENV: "1", HERDR_PANE_ID: "own-herdr" } : {}),
  };
  on("env.get", ($, e) => { effects.push("env.get"); return { value: env[e.name] }; });
  on("session.id", () => { effects.push("session.id"); return { value: options.selfId ?? SELF }; });
  on("session.cwd", () => { effects.push("session.cwd"); return { value: PRODUCT }; });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("ui.render", () => ENGINE_DRAWING as never);
  on("fs.exists", ($, e) => {
    effects.push("fs.exists"); fsCalls.push({ op: "exists", path: e.path, at: clock.now() });
    return { value: files.has(e.path) };
  });
  on("fs.read", ($, e) => {
    effects.push("fs.read"); fsCalls.push({ op: "read", path: e.path, at: clock.now() });
    const value = files.get(e.path);
    return value === undefined || h.denyReads ? { deny: "not found" } : { value };
  });
  on("fs.list", ($, e) => {
    effects.push("fs.list"); fsCalls.push({ op: "list", path: e.path, at: clock.now() });
    const prefix = e.path.replace(/\/+$/, "") + "/";
    const entries = new Map<string, FsEntry>();
    for (const [path, text] of files) {
      if (!path.startsWith(prefix)) continue;
      const suffix = path.slice(prefix.length), name = suffix.split("/")[0]!;
      entries.set(name, { name, kind: suffix.includes("/") ? "dir" : "file", size: text.length, mtimeMs: clock.now(), isLink: false });
    }
    return { value: [...entries.values()] };
  });
  on("process.run", ($, e) => {
    effects.push("process.run");
    const argv = [...e.argv]; commands.push(argv);
    const herdr = argv[0] === "herdr" || argv[0] === ROOT + "/.local/bin/herdr";
    if (herdr && (h.herdrUnavailable || (argv[0] === "herdr" && h.herdrAtFallback))) return { deny: "herdr executable unavailable" };
    if (argv[0] === "env" && argv.includes("ps")) {
      if (h.denyPs) return { deny: "ps unavailable" };
      const pids = argv[argv.indexOf("-p") + 1]!.split(",").map(Number);
      return { value: ok(pids.filter(pid => starts.has(pid)).map(pid => pid + " " + starts.get(pid)).join("\n")) };
    }
    if ((argv[0] === "tmux" && argv[1] === "capture-pane") || (herdr && argv[1] === "pane" && argv[2] === "read"))
      return { value: ok(h.captureText, h.captureExit, h.captureExit ? "pane missing" : "") };
    if (argv[0] === "tmux" && argv[1] === "display-message") return { value: ok(h.client) };
    if ((argv[0] === "tmux" && ["switch-client", "select-window", "select-pane"].includes(argv[1]!)) || (herdr && argv[1] === "agent" && argv[2] === "focus")) return { value: ok() };
    if (argv[0] === "open" || argv[0] === "xdg-open") {
      const code = h.openerExits.shift() ?? 1;
      return { value: ok("", code, code ? "opener unavailable" : "") };
    }
    return { deny: "Unplanned fake-machine command: " + argv.join(" ") };
  });
  on("ui.panes", () => { effects.push("ui.panes"); return { value: h.panes }; });
  on("ui.open", ($, e) => {
    effects.push("ui.open"); opens.push({ id: e.id, title: e.title, columns: e.columns, rows: e.rows });
    h.panes = [{ id: e.id, title: e.title ?? e.id, isShown: h.placed, isFocused: false, isPlaced: h.placed }];
    return { value: h.placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: "test surface has no room" } };
  });
  on("ui.close", ($, e) => {
    effects.push("ui.close"); closes.push(e.id); h.panes = h.panes.filter(p => p.id !== e.id);
    return { value: undefined };
  });
  on("ui.toast", ($, e) => { effects.push("ui.toast"); toasts.push(e.text); return { value: undefined }; });
  on("ui.log", () => { effects.push("ui.log"); return { value: undefined }; });
  on("state.get", ($, e, next) => { effects.push("state.get"); return next(e); });
  on("state.set", ($, e, next) => { effects.push("state.set"); return next(e); });
  on("prompt.fill", ($, e) => {
    effects.push("prompt.fill"); fills.push({ text: e.text, mode: e.mode });
    return { isFilled: h.fillAllowed };
  });
  return h;
}
export type Machine = ReturnType<typeof machine>;
export function seedFamily(h: Machine, children = 1) {
  const records = [
    record({ key: TRIAGE, sessionId: "triage01", role: "triage", parent: null, name: "triage", pid: 700 }),
    record(),
    ...Array.from({ length: children }, (_, i) => record({
      key: i === 0 ? CHILD : "s-child" + String(i + 1).padStart(3, "0"),
      sessionId: "child" + String(i + 1).padStart(3, "0"),
      role: "child", parent: MANAGER, name: "child-" + String(i + 1).padStart(2, "0"),
      pid: 702 + i, createdAt: NOW - 1000 + i,
    })),
  ];
  for (const r of records) { h.seed(r); h.native(r, r.key === MANAGER ? "busy" : "idle"); }
  h.alias(SELF, MANAGER);
  return records;
}
export async function start($: Engine, h: Machine, surface: Surface) {
  await $.session.start({ cwd: PRODUCT, surface, isInteractive: true });
  await h.clock.advance(2000);
}
export const captures = (h: Machine) => h.commands.filter(argv => argv.includes("capture-pane") || ((argv[0] === "herdr" || argv[0]?.endsWith("/herdr")) && argv[2] === "read"));
