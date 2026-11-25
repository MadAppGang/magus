/**
 * Per-server sharing. Idle stop applies to every server; sharing exists only
 * for gopls, through its own `-remote=auto` daemon.
 *
 * gopls names the daemon socket
 *   <XDG_RUNTIME_DIR | TMPDIR | /tmp>/<basename>-<6 hex>-daemon.<USER | shared>-<id>
 * where the 6 hex identify the gopls binary. Every input that changes what the
 * daemon would answer and is NOT in that path goes into the id, so two sessions
 * that would get different answers never meet on one daemon.
 */

import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readlinkSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { worktreeRoot } from "./worktree.ts";

export type Env = Record<string, string | undefined>;

export interface SharedPlan {
	id: string;
	/** The socket gopls will use, its 6 binary hex shown as `******`. */
	socketPath: string;
}

export interface ShareInput {
	/** The server binary as found on PATH. */
	resolved: string;
	/** The arguments configured after the command. */
	configuredArgs: string[];
	env: Env;
	cwd: string;
	platform: string;
}

export interface ShareResult {
	argv: string[];
	shared: SharedPlan | null;
	notes: string[];
}

export interface Adapter {
	name: string;
	share(input: ShareInput): ShareResult;
}

/** The environment the gopls daemon reads that its socket path does not carry. */
export const FINGERPRINT_VARS = [
	"GOWORK",
	"GOPACKAGESDRIVER",
	"GOROOT",
	"GOTOOLCHAIN",
	"GOFLAGS",
	"HOME",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"MISE_GO_VERSION",
	"ASDF_GOLANG_VERSION",
	"GOENV_VERSION",
] as const;

export const GOPLS_LISTEN_TIMEOUT = "1m";

/** Longest unix socket path, in bytes, that connect() accepts. */
export function socketLimit(platform: string): number | null {
	if (platform === "darwin") return 103;
	if (platform === "linux") return 107;
	return null;
}

function realpathOrSelf(path: string | null): string {
	if (!path) return "";
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** First 10 hex of sha256 over the worktree root and the gopls fingerprint. */
export function goplsId(root: string, env: Env): string {
	const path = env.PATH ?? "";
	const parts = [
		root,
		realpathOrSelf(Bun.which("go", { PATH: path })),
		realpathOrSelf(Bun.which("gopackagesdriver", { PATH: path })),
		...FINGERPRINT_VARS.map((name) => {
			const value = env[name];
			return value === undefined ? name : `${name}=${value}`;
		}),
	];
	return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 10);
}

function startsWithShebang(file: string): boolean {
	let fd: number | null = null;
	try {
		fd = openSync(file, "r");
		const head = Buffer.alloc(2);
		return readSync(fd, head, 0, 2, 0) === 2 && head.toString("latin1") === "#!";
	} catch {
		return false;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

/**
 * The basename length gopls may put in the socket path. On macOS it uses the
 * path it was invoked by, on Linux the resolved one; the longer of the two
 * covers both. A script wrapper execs a binary this cannot see, so it is
 * given at least 16 bytes.
 */
export function guardBasenameBytes(resolved: string): number {
	const invoked = Buffer.byteLength(basename(resolved));
	const real = Buffer.byteLength(basename(realpathOrSelf(resolved)));
	const longer = Math.max(invoked, real);
	return startsWithShebang(resolved) ? Math.max(longer, 16) : longer;
}

export interface SocketGuess {
	socketPath: string;
	/** The byte length the real path can reach. */
	bytes: number;
}

/** The directory gopls puts its socket in: XDG_RUNTIME_DIR, else Go's os.TempDir(). */
export function goplsSocketDir(env: Env): string {
	return env.XDG_RUNTIME_DIR || env.TMPDIR || "/tmp";
}

/**
 * Why `dir` cannot hold a socket only this user reaches, or null when it can.
 * The gopls daemon does not check who connects, so the directory itself must
 * be the boundary: a real directory (not a symbolic link), owned by the current
 * user, with no group or other permission bits at all. Only the mode is read;
 * an ACL entry on a macOS directory is not.
 */
export function socketDirProblem(dir: string, uid: number | null): string | null {
	let st: ReturnType<typeof lstatSync>;
	try {
		// A trailing slash would make lstat follow a symbolic link.
		st = lstatSync(dir.replace(/(.)\/+$/, "$1"));
	} catch {
		return "does not exist";
	}
	if (st.isSymbolicLink()) return "is a symbolic link";
	if (!st.isDirectory()) return "is not a directory";
	if (uid === null || st.uid !== uid) return "belongs to another user";
	if ((Number(st.mode) & 0o077) !== 0) return "is open to other users (group or other permission bits set)";
	return null;
}

/** The user part of the socket name, as gopls reads it. */
export function goplsSocketUser(env: Env): string {
	return env.USER || "shared";
}

/** Why `user` could move the socket out of its directory, or null when it cannot. */
export function socketUserProblem(user: string): string | null {
	if (user === "" || user === "." || user === ".." || user.includes("/")) return "is not a single file name";
	return null;
}

/**
 * The socket path the way gopls builds it: Go's filepath.Join cleans the whole
 * path lexically, `..` included, as path.join does.
 */
export function goplsSocketPath(resolved: string, env: Env, id: string): SocketGuess {
	const dir = goplsSocketDir(env);
	const shown = basename(resolved);
	const socketPath = join(dir, `${shown}-******-daemon.${goplsSocketUser(env)}-${id}`);
	const bytes = Buffer.byteLength(socketPath) - Buffer.byteLength(shown) + guardBasenameBytes(resolved);
	return { socketPath, bytes };
}

/** Most symbolic links followed by `physicalPath`, as the kernel's own loop limit. */
const MAX_LINKS = 40;

/**
 * The directory `path` names when the filesystem walks it: each `..` steps out
 * of the directory reached so far, after any symbolic link before it was
 * followed. `realpathSync` cleans `..` lexically first, so `a/link/..` would
 * come back as `a` where the kernel reaches the link target's parent. Throws
 * when a component is missing or the links loop.
 */
export function physicalPath(path: string, cwd: string = process.cwd()): string {
	const pending = (isAbsolute(path) ? path : `${cwd}/${path}`).split("/").reverse();
	let current = "/";
	let links = 0;
	while (pending.length > 0) {
		const part = pending.pop() as string;
		if (part === "" || part === ".") continue;
		if (part === "..") {
			current = dirname(current);
			continue;
		}
		const next = join(current, part);
		if (!lstatSync(next).isSymbolicLink()) {
			current = next;
			continue;
		}
		if (++links > MAX_LINKS) throw new Error(`too many symbolic links in ${path}`);
		const target = readlinkSync(next);
		if (isAbsolute(target)) current = "/";
		pending.push(...target.split("/").reverse());
	}
	return realpathSync(current);
}

/**
 * Why the directory the socket lands in is not the checked runtime directory,
 * or is not owner-only, else null. The lexically cleaned parent is what gopls
 * dials; it must be owner-only itself and resolve to the same directory the
 * filesystem reaches through the runtime directory as written. Both sides are
 * resolved, because a system link such as macOS `/var` sits above the per-user
 * TMPDIR.
 */
export function socketParentProblem(socketPath: string, env: Env, uid: number | null): { dir: string; problem: string } | null {
	const dir = dirname(socketPath);
	const problem = socketDirProblem(dir, uid);
	if (problem !== null) return { dir, problem };
	let parent: string;
	let runtime: string;
	try {
		parent = physicalPath(dir);
		runtime = physicalPath(goplsSocketDir(env));
	} catch {
		return { dir, problem: "cannot be resolved" };
	}
	if (parent !== runtime) return { dir, problem: `is not the runtime directory ${goplsSocketDir(env)}` };
	return null;
}

export const gopls: Adapter = {
	name: "gopls",
	share({ resolved, configuredArgs, env, cwd, platform }) {
		const plain = { argv: [resolved, ...configuredArgs], shared: null };
		if (configuredArgs.length > 0) {
			return { ...plain, notes: ["gopls has configured arguments, so it runs unshared"] };
		}
		const limit = socketLimit(platform);
		if (limit === null) {
			return { ...plain, notes: [`gopls sharing is not supported on ${platform}, so it runs unshared`] };
		}
		const user = goplsSocketUser(env);
		const userProblem = socketUserProblem(user);
		if (userProblem !== null) {
			return { ...plain, notes: [`USER ${JSON.stringify(user)} ${userProblem}, so gopls runs unshared`] };
		}
		const id = goplsId(worktreeRoot(cwd), env);
		const { socketPath, bytes } = goplsSocketPath(resolved, env, id);
		const parent = socketParentProblem(socketPath, env, process.getuid?.() ?? null);
		if (parent !== null) {
			return { ...plain, notes: [`gopls socket directory ${parent.dir} ${parent.problem}, so it runs unshared`] };
		}
		if (bytes > limit) {
			return {
				...plain,
				notes: [`gopls socket path ${socketPath} can reach ${bytes} bytes, over the ${limit} limit, so it runs unshared`],
			};
		}
		return {
			argv: [resolved, `-remote=auto;${id}`, `-remote.listen.timeout=${GOPLS_LISTEN_TIMEOUT}`],
			shared: { id, socketPath },
			notes: [],
		};
	},
};

const ADAPTERS: Record<string, Adapter> = { gopls };

/** The adapter for a configured command, by its basename. */
export function adapterFor(command: string): Adapter | null {
	return ADAPTERS[basename(command)] ?? null;
}
