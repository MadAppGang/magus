#!/usr/bin/env bun
// Resolves a ticket reference to its tracker, its window name and its colour.
//
// Usage:
//   bun ticket-ref.ts <ref> [--labels <comma-separated>] [--words "<w1 w2 …>"] [--dir <checkout>]
//
//   <ref>     #N, owner/repo#N, a github.com issue URL, a linear.app issue URL, or a key like ABC-123
//   --labels  the ticket's labels; picks the colour (red, green or blue)
//   --words   2 to 4 title words; with them the window name is printed
//   --dir     the checkout whose `origin` remote names "this repo"; defaults to the current directory
//
// Prints one JSON object: {tracker, id, slug, repo, number, colour, name}.
// `colour` is null when no labels were given or none matched; `name` is null
// when no words were given. `tracker` is "key" for a bare ABC-123 key, whose
// tracker the reference alone cannot name. `repo` is null for `#N` when the
// checkout has no github.com `origin` remote.
//
// Exit codes:
//   0  resolved
//   1  bad input or an unrecognised reference

import { resolve } from "node:path";
import { buildTicketName, colourForLabels, parseTicketRef, repoFromRemoteUrl } from "./lib/ticket.ts";

const ACCEPTED = "#N, owner/repo#N, https://github.com/<owner>/<repo>/issues/N, https://linear.app/<workspace>/issue/ABC-123, or ABC-123";

function fail(msg: string): never {
  console.error(`ticket-ref: ${msg}`);
  console.error('usage: <ref> [--labels <comma-separated>] [--words "<w1 w2 …>"] [--dir <checkout>]');
  process.exit(1);
}

interface Args {
  ref: string;
  labels?: string;
  words?: string;
  dir?: string;
}

function parseCli(argv: readonly string[]): Args {
  let ref: string | undefined;
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--labels" || token === "--words" || token === "--dir") {
      const key = token.slice(2);
      if (values.has(key)) fail(`${token} given more than once`);
      const value = argv[i + 1];
      if (value === undefined) fail(`${token} needs a value`);
      values.set(key, value);
      i++;
    } else if (token.startsWith("--")) {
      fail(`unknown flag ${JSON.stringify(token)}`);
    } else if (ref === undefined) {
      ref = token;
    } else {
      fail(`unexpected argument ${JSON.stringify(token)}`);
    }
  }
  if (ref === undefined || ref.trim() === "") fail("a ticket reference is required");
  const args: Args = { ref };
  for (const key of ["labels", "words", "dir"] as const) {
    const value = values.get(key);
    if (value !== undefined) args[key] = value;
  }
  return args;
}

function originRepo(dir: string): string | null {
  try {
    const p = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    return p.exitCode === 0 ? repoFromRemoteUrl(p.stdout.toString()) : null;
  } catch {
    // No git, or no such directory: there is no "this repo" to compare with.
    return null;
  }
}

const args = parseCli(process.argv.slice(2));
const dir = args.dir !== undefined ? resolve(args.dir) : process.cwd();
const thisRepo = originRepo(dir);

const ticket = parseTicketRef(args.ref, thisRepo);
if (ticket === null) fail(`unrecognised ticket reference ${JSON.stringify(args.ref)}; accepted: ${ACCEPTED}`);

const labels = args.labels
  ?.split(",")
  .map((l) => l.trim())
  .filter((l) => l !== "");
const colour = labels !== undefined && labels.length > 0 ? colourForLabels(labels) : null;

let name: string | null = null;
if (args.words !== undefined) {
  try {
    name = buildTicketName(ticket.slug, args.words.split(/\s+/).filter((w) => w !== ""));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

console.log(JSON.stringify({ ...ticket, colour, name }, null, 2));
process.exit(0);
