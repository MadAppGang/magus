import { appendFileSync, closeSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { frame, splitFrame } from "./wire.ts";

const env = process.env;
const shared = process.argv.some(arg => arg.startsWith("-remote=auto;"));
const mode = (shared ? env.FAKE_SHARED : env.FAKE_PLAIN) || "normal";

function record(event: string, fields = {}) {
  appendFileSync(env.FAKE_LOG!, JSON.stringify({ event, pid: process.pid, shared, ...fields }) + "\n");
}
function linger() { setInterval(() => {}, 60_000); }

if (process.argv.includes("--grandchild")) {
  record("grandchild");
  // Hold the old stdout pipe open after the parent exits, then try a late write.
  setTimeout(() => process.stdout.write("stale-grandchild-output"), 1000);
  linger();
} else {
  if (mode !== "check") record("start", { args: process.argv.slice(2), dotenv: env.MAGUS_LSP_UNEXPECTED_DOTENV });
  switch (mode) {
    case "check":
      record("check");
      linger();
      break;
    case "never-read":
      linger();
      break;
    case "closed-stdin":
      closeSync(0);
      record("closed");
      linger();
      break;
    case "garbage":
      process.stdout.write("Content-Length: invalid\r\n\r\nserver-garbage");
      await read();
      break;
    case "idle-probe":
      process.on("SIGTERM", () => record("term"));
      await read();
      break;
    case "burst":
      process.on("SIGTERM", () => record("term"));
      process.stdout.write(Buffer.alloc(8 * 1024 * 1024, "z"));
      record("burst");
      linger();
      break;
    case "buffered":
      await new Promise<void>((resolve, reject) => {
        process.stdout.write("!", error => error ? reject(error) : resolve());
      });
      process.exit(3);
      break;
    case "exit":
      process.exit(Number(env.FAKE_EXIT_CODE || 0));
      break;
    case "signalled":
      process.kill(process.pid, "SIGKILL");
      break;
    default:
      await read();
  }
}

async function read() {
  let pending = Buffer.alloc(0);
  for await (const data of process.stdin) {
    const chunk = Buffer.from(data);
    if (env.FAKE_RAW) appendFileSync(env.FAKE_RAW + (shared ? ".shared" : ".plain"), chunk);
    if (mode === "raw") {
      process.stdout.write(chunk);
      continue;
    }
    pending = Buffer.concat([pending, chunk]);
    for (let parsed; (parsed = splitFrame(pending)); ) {
      const { message, end } = parsed;
      pending = Buffer.from(pending.subarray(end));
      const method = message.method ?? message.Method ?? message.METHOD;
      record("frame", { method, id: message.id });
      if (method === "exit") process.exit(Number(env.FAKE_EXIT_CODE || 0));
      if (mode === "die" || mode === "descendant" || mode === "remove") {
        if (mode === "remove") unlinkSync(env.FAKE_BINARY!);
        if (mode === "descendant") {
          const grand = spawn(process.execPath, ["--no-env-file", import.meta.path, "--grandchild"], {
            stdio: ["ignore", "inherit", "inherit"],
          });
          record("spawned-grandchild", { descendant: grand.pid });
        }
        process.exit(3);
      }
      if (mode !== "silent" && message.id !== undefined) {
        process.stdout.write(frame({ jsonrpc: "2.0", id: message.id, result: shared ? "shared" : "plain" }));
      }
    }
  }
  record("eof");
  if (env.FAKE_EOF_DELAY) await Bun.sleep(Number(env.FAKE_EOF_DELAY));
  process.exit(Number(env.FAKE_EOF_CODE || 0));
}
