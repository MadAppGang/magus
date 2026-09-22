#!/usr/bin/env bun
/**
 * SessionStart (matcher `startup`) — report a magus CLI that is behind npm. The check is
 * lib/magus-cli-version.ts; read it for what is checked and why it lives in this plugin.
 *
 * WHY THIS FILE ONLY RELAUNCHES. The hook may write two files, the shared cache and the
 * claim marker that keeps one session start to one notice. Bun writes
 * another: before a script's first line runs, it caches the transpiled output of every
 * source of 4096 bytes or more under $XDG_CACHE_HOME/bun (macOS: ~/Library/Caches/bun),
 * and it reads the switch that turns this off, BUN_RUNTIME_TRANSPILER_CACHE_PATH=0, only
 * at startup. So this file stays under 4096 bytes, which Bun never caches, and runs the
 * check in a child started with the switch set. Keep it under that size, or the
 * relaunch buys nothing.
 *
 * WHY --config=/dev/null, HERE AND IN hooks.json. The cwd is the user's project, and
 * Bun runs its bunfig.toml `preload` before a script's first line, so before any
 * watchdog or handler exists. A preload that is missing or throws exits 1, one that
 * prints corrupts the JSON, one that sleeps outruns the timeout. Every bun this hook
 * starts must carry the flag; --env-file=/dev/null covers .env, not bunfig.
 *
 * Exit 0 always, nothing on stderr, and a watchdog inside the 3 s the hook promises.
 */
const WATCHDOG_MS = 2_700;
const CHECK = `${import.meta.dir}/lib/magus-cli-version.ts`;

let child: ReturnType<typeof Bun.spawn> | undefined;
const quit = (): never => {
  try {
    child?.kill("SIGKILL");
  } catch {
    // Already gone.
  }
  process.exit(0);
};
process.on("uncaughtException", quit);
process.on("unhandledRejection", quit);
setTimeout(quit, WATCHDOG_MS).unref();

try {
  child = Bun.spawn([process.execPath, "--env-file=/dev/null", "--config=/dev/null", CHECK], {
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = child.stdout instanceof ReadableStream ? await new Response(child.stdout).text() : "";
  if (out) await new Promise<void>((resolve) => process.stdout.write(out, () => resolve()));
} catch {
  // Silence is the only failure mode this hook has.
}
process.exit(0);
