/**
 * requires-probe — the one reader of a plugin.json `requires` block.
 *
 * Everything that asks "what does this plugin need, is it here, and how is it
 * installed" goes through this file: the SessionStart hook every declaring
 * plugin carries (`hooks/deps-check.ts`), magus-cli, and the repo gate
 * `scripts/check-plugin-requires.ts`. Parsing, presence, option selection and
 * the human rendering of an install step exist here once.
 *
 * WHY IT IS COPIED. A plugin root must be self-contained: plugins install and
 * update separately, so a hook cannot import out of magus-cli or another
 * plugin's tree. The reference lives in tools/magus/src/shared/plugin/; each
 * declaring plugin carries a byte-identical copy under `hooks/lib/`, and
 * `scripts/check-hook-copies.ts` makes drift a failed check. A hook copy always
 * matches its own plugin.json, because the two ship in one plugin version.
 *
 * Dependency-free (`node:*` only) so the copy runs from a bare plugin root.
 * Nothing here spawns a shell: a check is an argv, and the only expansion is
 * `${CLAUDE_PLUGIN_ROOT}`.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, accessSync, readFileSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** The one `requires` shape this reader knows. Any change to it bumps this. */
export const REQUIRES_SCHEMA = 1;

export type Os = "darwin" | "linux";
export type Arch = "amd64" | "arm64";
export type Platform = `${Os}_${Arch}`;

const OSES: readonly Os[] = ["darwin", "linux"];
const ARCHES: readonly Arch[] = ["amd64", "arm64"];
const PLATFORMS: readonly Platform[] = [
	"darwin_amd64",
	"darwin_arm64",
	"linux_amd64",
	"linux_arm64",
];

/** The user prefixes the toolchains install into. Never on PATH by default. */
export const BUN_PREFIX = "~/.bun/bin";
export const LOCAL_PREFIX = "~/.local/bin";
export type UserPrefix = typeof BUN_PREFIX | typeof LOCAL_PREFIX;

export interface Bootstrap {
	url: string;
	interpreter: "sh" | "bash";
	prefix: UserPrefix;
	/** Tools the upstream installer script itself runs. */
	needs: readonly string[];
	/**
	 * The environment the installer runs with: what keeps it out of the user's
	 * rc files, so the PATH line magus prints is the only one.
	 */
	env?: Readonly<Record<string, string>>;
	/**
	 * The installer adds `prefix` to the user's rc file itself and has no
	 * switch to stop it, so magus prints no PATH line ahead of it; once it has
	 * run, the rc file is read to see whether it did.
	 */
	editsRc?: true;
}

/**
 * The only toolchain bootstraps. A manifest names an entry by key; it never
 * carries a URL or shell text. Homebrew is deliberately absent: its installer
 * needs an interactive password and the Command Line Tools.
 */
export const TOOLCHAIN_BOOTSTRAP = {
	bun: {
		url: "https://bun.sh/install",
		interpreter: "bash",
		prefix: BUN_PREFIX,
		needs: ["curl", "unzip"],
		editsRc: true,
	},
	uv: {
		url: "https://astral.sh/uv/install.sh",
		interpreter: "sh",
		prefix: LOCAL_PREFIX,
		needs: ["curl"],
		env: { UV_NO_MODIFY_PATH: "1" },
	},
} as const satisfies Record<string, Bootstrap>;

export type BootstrapTool = keyof typeof TOOLCHAIN_BOOTSTRAP;

type Base = { os?: Os[] };
export type InstallOption =
	| (Base & { via: "bun"; package: string; version?: string })
	// Exactly one of `formula` and `cask`: a cask installs with `--cask`.
	| (Base & { via: "brew"; formula: string; cask?: never })
	| (Base & { via: "brew"; cask: string; formula?: never })
	| (Base & { via: "apt"; packages: string[] })
	| (Base & {
			via: "release";
			repo: string;
			tag: string;
			/**
			 * The asset's file name, with `{os}` and `{arch}` substituted. One
			 * ending in `.tar.gz` or `.tgz` is an archive holding `binary`;
			 * any other name is the binary itself.
			 */
			asset: string;
			/** The installed file's name (and, for an archive, its entry). */
			binary: string;
			/** How this release spells each arch in `{arch}`, when not `amd64`/`arm64`. */
			arch?: Partial<Record<Arch, string>>;
			sha256: Partial<Record<Platform, string>>;
	  })
	| (Base & { via: "bootstrap"; tool: BootstrapTool })
	| (Base & { via: "uv-script"; script: string; args: string[] })
	| (Base & {
			via: "uv-module";
			script: string;
			module: string;
			args: string[];
			root?: true;
	  })
	// Profile-only: a profile's cliTools use these; a plugin.json may not.
	| (Base & { via: "npm" | "pip" | "go"; package: string; version?: string });

export type Via = InstallOption["via"];

export interface Requirement {
	name: string;
	check: string[];
	os?: Os[];
	install: InstallOption[];
}

export type ParseResult =
	| { ok: true; requirements: Requirement[] }
	| {
			ok: false;
			kind: "invalid" | "newer-schema" | "older-schema";
			errors: string[];
	  };

// ─── parsing ──────────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_NAME_RE = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const VERSION_RE = /^[A-Za-z0-9_.+~^<>=*-]*[A-Za-z0-9*]$/;
const FORMULA_RE = /^[a-z0-9][a-z0-9+._@/-]*$/;
const APT_RE = /^[a-z0-9][a-z0-9+.-]+$/;
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const TAG_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const ASSET_RE = /^[A-Za-z0-9._-]+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MODULE_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SCRIPT_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";

const PROFILE_ONLY: readonly Via[] = ["npm", "pip", "go"];

/** Archive names a release asset may not carry: only a tar.gz is extracted. */
const UNSUPPORTED_ARCHIVE_RE =
	/\.(zip|tar|tar\.xz|txz|tar\.bz2|tbz2?|gz|xz|bz2|7z)$/;

/**
 * What a release asset is: a `.tar.gz`/`.tgz` archive holding the binary, or
 * the binary itself. Read from the asset's name, so a declaration states it once.
 */
export function releaseFormat(asset: string): "tar.gz" | "binary" {
	return /\.(tar\.gz|tgz)$/.test(asset) ? "tar.gz" : "binary";
}

/**
 * The release asset's file name on one platform: `{os}` and `{arch}`
 * substituted, `{arch}` in the release's own spelling (`arch`). The one
 * substitution — the installer, the by-hand line and `scripts/pin-release.ts`
 * all call it.
 */
export function releaseAsset(
	option: { asset: string; arch?: Partial<Record<Arch, string>> },
	os: Os,
	arch: Arch,
): string {
	return option.asset
		.replaceAll("{os}", os)
		.replaceAll("{arch}", option.arch?.[arch] ?? arch);
}

/** The keys each `via` allows, besides `via` and `os`. */
const OPTION_KEYS: Record<Via, readonly string[]> = {
	bun: ["package", "version"],
	brew: ["formula", "cask"],
	apt: ["packages"],
	release: ["repo", "tag", "asset", "binary", "arch", "sha256"],
	bootstrap: ["tool"],
	"uv-script": ["script", "args"],
	"uv-module": ["script", "module", "args", "root"],
	npm: ["package", "version"],
	pip: ["package", "version"],
	go: ["package", "version"],
};

/** Toolchains an option kind needs declared beside it in the same plugin. */
const OPTION_PREREQ: Partial<Record<Via, string>> = {
	bun: "bun",
	"uv-script": "uv",
	"uv-module": "uv",
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const isStrArray = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((s) => typeof s === "string");

function unknownKeys(
	at: string,
	o: Obj,
	allowed: readonly string[],
	errors: string[],
): void {
	for (const key of Object.keys(o)) {
		if (!allowed.includes(key)) errors.push(`${at}: unknown key "${key}"`);
	}
}

function parseOs(at: string, v: unknown, errors: string[]): Os[] | undefined {
	if (v === undefined) return undefined;
	if (
		!isStrArray(v) ||
		v.length === 0 ||
		!v.every((s) => (OSES as readonly string[]).includes(s))
	) {
		errors.push(`${at}.os: must be a non-empty list of ${OSES.join(" | ")}`);
		return undefined;
	}
	return v as Os[];
}

function checkScript(at: string, v: unknown, errors: string[]): string {
	if (typeof v !== "string" || !SCRIPT_RE.test(v)) {
		errors.push(`${at}.script: must be a relative path inside the plugin root`);
		return "";
	}
	if (v.split("/").some((part) => part === "." || part === "..")) {
		errors.push(`${at}.script: must not contain "." or ".." segments`);
	}
	return v;
}

function checkArgs(at: string, v: unknown, errors: string[]): string[] {
	if (!isStrArray(v)) {
		errors.push(`${at}.args: must be a list of strings`);
		return [];
	}
	return v;
}

function req(
	at: string,
	o: Obj,
	key: string,
	re: RegExp,
	errors: string[],
): string {
	const v = o[key];
	if (typeof v !== "string" || !re.test(v)) {
		errors.push(`${at}.${key}: missing or malformed`);
		return "";
	}
	return v;
}

function parseOption(
	at: string,
	raw: unknown,
	reqName: string,
	errors: string[],
): InstallOption | null {
	if (!isObj(raw)) {
		errors.push(`${at}: must be an object`);
		return null;
	}
	const via = raw.via;
	if (typeof via !== "string" || !(via in OPTION_KEYS)) {
		errors.push(`${at}: unknown via "${String(via)}"`);
		return null;
	}
	const kind = via as Via;
	if (PROFILE_ONLY.includes(kind)) {
		errors.push(`${at}: via ${kind} is not allowed in plugin.json`);
		return null;
	}
	unknownKeys(at, raw, ["via", "os", ...OPTION_KEYS[kind]], errors);
	const os = parseOs(at, raw.os, errors);
	const base = os ? { os } : {};
	switch (kind) {
		case "bun": {
			const option: InstallOption = {
				...base,
				via: "bun",
				package: req(at, raw, "package", NPM_NAME_RE, errors),
			};
			if (raw.version !== undefined) {
				option.version = req(at, raw, "version", VERSION_RE, errors);
			}
			return option;
		}
		case "brew":
			if ((raw.formula === undefined) === (raw.cask === undefined)) {
				errors.push(`${at}: brew takes exactly one of formula and cask`);
				return null;
			}
			return raw.cask !== undefined
				? {
						...base,
						via: "brew",
						cask: req(at, raw, "cask", FORMULA_RE, errors),
					}
				: {
						...base,
						via: "brew",
						formula: req(at, raw, "formula", FORMULA_RE, errors),
					};
		case "apt": {
			const packages = raw.packages;
			if (
				!isStrArray(packages) ||
				packages.length === 0 ||
				!packages.every((p) => APT_RE.test(p))
			) {
				errors.push(
					`${at}.packages: must be a non-empty list of apt package names`,
				);
				return null;
			}
			return { ...base, via: "apt", packages };
		}
		case "release": {
			const asset = req(at, raw, "asset", /^.+$/, errors);
			const stripped = asset.replaceAll("{os}", "").replaceAll("{arch}", "");
			if (asset && !ASSET_RE.test(stripped)) {
				errors.push(
					`${at}.asset: only {os} and {arch} may be substituted into a file name`,
				);
			} else if (
				asset &&
				releaseFormat(asset) === "binary" &&
				UNSUPPORTED_ARCHIVE_RE.test(asset)
			) {
				errors.push(
					`${at}.asset: an archive must be .tar.gz or .tgz; any other name is installed as the binary itself`,
				);
			}
			let arch: Partial<Record<Arch, string>> | undefined;
			if (raw.arch !== undefined) {
				arch = {};
				if (!isObj(raw.arch)) {
					errors.push(
						`${at}.arch: must map amd64/arm64 to the release's spelling`,
					);
				} else {
					for (const [from, to] of Object.entries(raw.arch)) {
						if (!(ARCHES as readonly string[]).includes(from)) {
							errors.push(`${at}.arch: unknown arch "${from}"`);
						} else if (typeof to !== "string" || !ASSET_RE.test(to)) {
							errors.push(`${at}.arch.${from}: missing or malformed`);
						} else {
							arch[from as Arch] = to;
						}
					}
				}
			}
			const sha256: Partial<Record<Platform, string>> = {};
			if (!isObj(raw.sha256)) {
				errors.push(`${at}.sha256: must map {os}_{arch} to a sha256 digest`);
			} else {
				for (const [platform, digest] of Object.entries(raw.sha256)) {
					if (!(PLATFORMS as readonly string[]).includes(platform)) {
						errors.push(`${at}.sha256: unknown platform "${platform}"`);
					} else if (typeof digest !== "string" || !SHA256_RE.test(digest)) {
						errors.push(`${at}.sha256.${platform}: must be 64 lowercase hex`);
					} else {
						sha256[platform as Platform] = digest;
					}
				}
			}
			return {
				...base,
				via: "release",
				repo: req(at, raw, "repo", REPO_RE, errors),
				tag: req(at, raw, "tag", TAG_RE, errors),
				asset,
				binary: req(at, raw, "binary", TAG_RE, errors),
				...(arch ? { arch } : {}),
				sha256,
			};
		}
		case "bootstrap": {
			const tool = raw.tool;
			if (typeof tool !== "string" || !(tool in TOOLCHAIN_BOOTSTRAP)) {
				errors.push(
					`${at}.tool: must be one of ${Object.keys(TOOLCHAIN_BOOTSTRAP).join(", ")}`,
				);
				return null;
			}
			if (tool !== reqName) {
				errors.push(
					`${at}.tool: bootstraps "${tool}" for a requirement named "${reqName}"`,
				);
			}
			return { ...base, via: "bootstrap", tool: tool as BootstrapTool };
		}
		case "uv-script":
			return {
				...base,
				via: "uv-script",
				script: checkScript(at, raw.script, errors),
				args: checkArgs(at, raw.args, errors),
			};
		case "uv-module": {
			const option: InstallOption = {
				...base,
				via: "uv-module",
				script: checkScript(at, raw.script, errors),
				module: req(at, raw, "module", MODULE_RE, errors),
				args: checkArgs(at, raw.args, errors),
			};
			if (raw.root !== undefined) {
				if (raw.root !== true) errors.push(`${at}.root: may only be true`);
				else option.root = true;
			}
			return option;
		}
		case "npm":
		case "pip":
		case "go":
			return null;
		default:
			return assertNever(kind);
	}
}

function parseRequirement(
	at: string,
	raw: unknown,
	errors: string[],
): Requirement | null {
	if (!isObj(raw)) {
		errors.push(`${at}: must be an object`);
		return null;
	}
	unknownKeys(at, raw, ["name", "check", "os", "install"], errors);
	const name = raw.name;
	if (typeof name !== "string" || !NAME_RE.test(name)) {
		errors.push(`${at}.name: missing or malformed`);
		return null;
	}
	const named = `${at} (${name})`;
	const check = raw.check;
	if (!isStrArray(check) || check.length === 0 || check.some((s) => !s)) {
		errors.push(`${named}.check: missing check (a non-empty argv)`);
	} else {
		for (const token of check) {
			if (token.replaceAll(ROOT_TOKEN, "").includes("${")) {
				errors.push(
					`${named}.check: only ${ROOT_TOKEN} is expanded, found "${token}"`,
				);
			}
		}
	}
	const os = parseOs(named, raw.os, errors);
	if (!Array.isArray(raw.install) || raw.install.length === 0) {
		errors.push(`${named}.install: must be a non-empty list of options`);
		return null;
	}
	const install = raw.install
		.map((o, i) => parseOption(`${named}.install[${i}]`, o, name, errors))
		.filter((o): o is InstallOption => o !== null);
	const requirement: Requirement = {
		name,
		check: isStrArray(check) ? check : [],
		install,
	};
	if (os) requirement.os = os;
	return requirement;
}

/**
 * Parse the `requires` key of a plugin.json. Nothing else in the manifest is
 * read. A manifest without `requires` declares nothing and parses as empty.
 */
export function parseRequires(pluginJson: unknown): ParseResult {
	if (!isObj(pluginJson)) {
		return {
			ok: false,
			kind: "invalid",
			errors: ["plugin.json: not an object"],
		};
	}
	const raw = pluginJson.requires;
	if (raw === undefined) return { ok: true, requirements: [] };
	if (!isObj(raw)) {
		return { ok: false, kind: "invalid", errors: ["requires: not an object"] };
	}
	const schema = raw.schema;
	if (typeof schema !== "number" || !Number.isInteger(schema)) {
		return {
			ok: false,
			kind: "invalid",
			errors: ["requires.schema: missing (this reader reads schema 1)"],
		};
	}
	if (schema > REQUIRES_SCHEMA) {
		return {
			ok: false,
			kind: "newer-schema",
			errors: [
				`declares requires schema ${schema}; this magus-cli reads ${REQUIRES_SCHEMA} — update magus-cli`,
			],
		};
	}
	if (schema < REQUIRES_SCHEMA) {
		return {
			ok: false,
			kind: "older-schema",
			errors: [
				`declares requires schema ${schema}; this magus-cli reads ${REQUIRES_SCHEMA} — update the plugin`,
			],
		};
	}
	const errors: string[] = [];
	unknownKeys("requires", raw, ["schema", "bin"], errors);
	if (!Array.isArray(raw.bin)) {
		errors.push("requires.bin: must be a list");
		return { ok: false, kind: "invalid", errors };
	}
	const requirements = raw.bin
		.map((r, i) => parseRequirement(`requires.bin[${i}]`, r, errors))
		.filter((r): r is Requirement => r !== null);

	const names = new Set<string>();
	for (const r of requirements) {
		if (names.has(r.name)) errors.push(`requires.bin: "${r.name}" twice`);
		names.add(r.name);
	}
	for (const r of requirements) {
		for (const option of r.install) {
			const needs = OPTION_PREREQ[option.via];
			if (needs && !names.has(needs)) {
				errors.push(
					`requires.bin (${r.name}): via ${option.via} needs "${needs}" declared in the same plugin`,
				);
			}
		}
	}
	if (errors.length > 0) return { ok: false, kind: "invalid", errors };
	return { ok: true, requirements };
}

// ─── identity ─────────────────────────────────────────────────────────────────

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (isObj(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

/**
 * `<name>-<first 12 hex of sha256(canonical declaration)>`. Identical
 * declarations in two plugins share a key, so a dep is reported once per
 * session however many plugins need it; different ones never hide each other.
 */
export function dedupeKey(r: Requirement): string {
	const digest = createHash("sha256").update(canonical(r)).digest("hex");
	return `${r.name}-${digest.slice(0, 12)}`;
}

// ─── platform and PATH ────────────────────────────────────────────────────────

/**
 * How much a probe runs.
 *
 * "presence" (the SessionStart hook): a requirement whose check runs its own
 * binary (`check[0]` is the requirement's name) is decided by the PATH lookup
 * alone, so a session start never waits on a slow `--version`; a dangling
 * symlink still reads as missing. Every other check runs, because it answers
 * something a lookup cannot (a script env, a marker file).
 *
 * "full" (`magus doctor`): every check runs.
 */
export type ProbeDepth = "presence" | "full";

export interface ProbeEnv {
	pluginRoot: string;
	os: Os;
	arch: Arch;
	home: string;
	/** The PATH the plugin's MCP servers and hooks inherit. */
	path: string;
	/** Per-check cap: the hook uses 3000, doctor 60000. */
	capMs: number;
	/** How much of each check to run — see {@link ProbeDepth}. */
	depth: ProbeDepth;
	/** `$SHELL`, to name the rc file for a PATH line. */
	userShell?: string;
}

/** This process's platform, or null on one the schema does not cover. */
export function currentPlatform(): { os: Os; arch: Arch } | null {
	const os =
		process.platform === "darwin" || process.platform === "linux"
			? process.platform
			: null;
	const arch =
		process.arch === "x64"
			? "amd64"
			: process.arch === "arm64"
				? "arm64"
				: null;
	return os && arch ? { os, arch } : null;
}

const appliesTo = (os: Os[] | undefined, current: Os): boolean =>
	os === undefined || os.includes(current);

/** The requirements that apply on `os`. */
export function applicable(reqs: Requirement[], os: Os): Requirement[] {
	return reqs.filter((r) => appliesTo(r.os, os));
}

function isExecutableFile(file: string): boolean {
	try {
		if (!statSync(file).isFile()) return false;
		accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** The executable `tool` resolves to on `path`, or null. No shell involved. */
export function onPath(tool: string, path: string): string | null {
	if (tool.includes("/")) return isExecutableFile(tool) ? tool : null;
	for (const dir of path.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, tool);
		if (isExecutableFile(candidate)) return candidate;
	}
	return null;
}

/** `~/x` → `<home>/x`. */
export function expandHome(dir: string, home: string): string {
	return dir.startsWith("~/") ? join(home, dir.slice(2)) : dir;
}

export interface UserPrefixInfo {
	dir: UserPrefix;
	rcLine(shell: string): string;
}

/**
 * The rc-file line that puts `dir` on PATH for `shell`: the one rendering of
 * it. `dir` is absolute or `~/…`; `~` becomes `$HOME`.
 */
export function pathRcLine(dir: string, shell: string): string {
	const shellDir = dir.replace(/^~/, "$HOME");
	return shell.endsWith("fish")
		? `fish_add_path ${shellDir}`
		: `export PATH="${shellDir}:$PATH"`;
}

function prefixRcLine(dir: UserPrefix): (shell: string) => string {
	return (shell) => pathRcLine(dir, shell);
}

/** Where bun, uv and released binaries land, and the line that puts each on PATH. */
export const USER_PREFIXES: readonly UserPrefixInfo[] = [
	{ dir: BUN_PREFIX, rcLine: prefixRcLine(BUN_PREFIX) },
	{ dir: LOCAL_PREFIX, rcLine: prefixRcLine(LOCAL_PREFIX) },
];

/** The rc file a PATH line belongs in, from `$SHELL`. */
export function rcFile(shell: string): string {
	if (shell.endsWith("zsh")) return "~/.zshrc";
	if (shell.endsWith("fish")) return "~/.config/fish/config.fish";
	return "~/.bashrc";
}

/** The files `shell` reads when a terminal starts it, `rcFile(shell)` first. */
function startupFiles(shell: string): string[] {
	if (shell.endsWith("zsh")) return ["~/.zshrc", "~/.zprofile", "~/.zshenv"];
	if (shell.endsWith("fish")) return ["~/.config/fish/config.fish"];
	return ["~/.bashrc", "~/.bash_profile"];
}

const SHELL_VAR_RE = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g;
const ASSIGN_RE = /^(?:export\s+)?([A-Za-z_]\w*)=(.*)$/;
const FISH_SET_RE = /^set\s+(?:-\S+\s+)*([A-Za-z_]\w*)\s+(.*)$/;
const PATH_EDIT_RE = /\bPATH\b|^fish_add_path\b|^path\+?=/;

/**
 * Does `text` (one rc file) put `abs` on PATH? A line that edits PATH counts
 * when, with `~`, `$HOME` and the variables the file assigns earlier
 * substituted, one of its words is `abs`. That reads the line magus prints,
 * a hand-written one, and bun's installer's
 * `export BUN_INSTALL="$HOME/.bun"` + `export PATH="$BUN_INSTALL/bin:$PATH"`.
 */
function textAddsToPath(text: string, abs: string, home: string): boolean {
	const vars = new Map([["HOME", home]]);
	const expand = (s: string): string =>
		s
			.replace(
				SHELL_VAR_RE,
				(whole: string, braced?: string, bare?: string) =>
					vars.get(braced ?? bare ?? "") ?? whole,
			)
			.replace(
				/(^|[\s:="'(])~(?=\/|$)/g,
				(_whole: string, lead: string) => `${lead}${home}`,
			);
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		if (PATH_EDIT_RE.test(line)) {
			const words = expand(line).split(/[\s:"'()=]+/);
			if (words.some((w) => w === abs || w === `${abs}/`)) return true;
		}
		const assign = line.match(ASSIGN_RE) ?? line.match(FISH_SET_RE);
		if (assign?.[1] && assign[2] !== undefined) {
			const value = expand(assign[2]);
			const quoted = /^(["']).*\1$/.test(value);
			vars.set(assign[1], quoted ? value.slice(1, -1) : value);
		}
	}
	return false;
}

/**
 * The startup file of `shell` (as `~/…`) that already puts `dir` on PATH, or
 * null. A PATH line is advice only while no such file exists: when one does,
 * the prefix is off the PATH only because Claude Code started without reading
 * it, and the fix is a restart, not a second line.
 */
export function rcFileAdding(
	dir: string,
	shell: string,
	home: string,
): string | null {
	const abs = expandHome(dir, home).replace(/\/+$/, "");
	for (const file of startupFiles(shell)) {
		let text: string;
		try {
			text = readFileSync(expandHome(file, home), "utf8");
		} catch {
			continue;
		}
		if (textAddsToPath(text, abs, home)) return file;
	}
	return null;
}

// ─── presence ─────────────────────────────────────────────────────────────────

export type Presence =
	| { name: string; status: "present" }
	| { name: string; status: "missing"; blockedBy?: string }
	| { name: string; status: "off-path"; prefix: UserPrefix }
	| { name: string; status: "unknown"; reason: string };

/** The check argv with `${CLAUDE_PLUGIN_ROOT}` expanded, and nothing else. */
export function expandCheck(r: Requirement, pluginRoot: string): string[] {
	return r.check.map((token) => token.replaceAll(ROOT_TOKEN, pluginRoot));
}

function offPathPrefix(tool: string, home: string): UserPrefix | null {
	if (tool.includes("/")) return null;
	for (const prefix of USER_PREFIXES) {
		if (isExecutableFile(join(expandHome(prefix.dir, home), tool))) {
			return prefix.dir;
		}
	}
	return null;
}

function runCheck(
	argv: string[],
	env: ProbeEnv,
): Promise<"pass" | "fail" | "timeout"> {
	return new Promise((resolve) => {
		const [cmd = "", ...args] = argv;
		const exe = onPath(cmd, env.path);
		if (!exe) {
			resolve("fail");
			return;
		}
		let settled = false;
		const settle = (outcome: "pass" | "fail" | "timeout"): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(outcome);
		};
		const child = spawn(exe, args, {
			cwd: env.pluginRoot,
			env: { ...process.env, PATH: env.path, HOME: env.home },
			stdio: "ignore",
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			settle("timeout");
		}, env.capMs);
		child.on("error", () => settle("fail"));
		child.on("exit", (code) => settle(code === 0 ? "pass" : "fail"));
	});
}

/** A check that did not pass: off PATH when a user prefix holds `tool`. */
function notFound(r: Requirement, tool: string, env: ProbeEnv): Presence {
	if (!onPath(tool, env.path)) {
		const prefix = offPathPrefix(tool, env.home);
		if (prefix) return { name: r.name, status: "off-path", prefix };
	}
	return { name: r.name, status: "missing" };
}

async function probeOne(r: Requirement, env: ProbeEnv): Promise<Presence> {
	const argv = expandCheck(r, env.pluginRoot);
	const tool = argv[0] ?? "";
	if (env.depth === "presence" && tool === r.name) {
		return onPath(tool, env.path)
			? { name: r.name, status: "present" }
			: notFound(r, tool, env);
	}
	const outcome = await runCheck(argv, env);
	if (outcome === "pass") return { name: r.name, status: "present" };
	if (outcome === "timeout") {
		return {
			name: r.name,
			status: "unknown",
			reason: `slow: no answer within ${Math.round(env.capMs / 1000)}s`,
		};
	}
	return notFound(r, tool, env);
}

/**
 * Probe every requirement that applies on `env.os`, in parallel. A check whose
 * argv[0] is another declared requirement waits for it, and is `missing` with
 * `blockedBy` when that one is not present — its own check could not run.
 */
export async function probe(
	reqs: Requirement[],
	env: ProbeEnv,
): Promise<Presence[]> {
	const live = applicable(reqs, env.os);
	const names = new Set(live.map((r) => r.name));
	const dependsOn = (r: Requirement): string | null => {
		const head = r.check[0];
		return head && head !== r.name && names.has(head) ? head : null;
	};
	const first = new Map<string, Presence>();
	await Promise.all(
		live
			.filter((r) => dependsOn(r) === null)
			.map(async (r) => first.set(r.name, await probeOne(r, env))),
	);
	await Promise.all(
		live
			.filter((r) => dependsOn(r) !== null)
			.map(async (r) => {
				const dep = dependsOn(r) as string;
				const depStatus = first.get(dep)?.status;
				first.set(
					r.name,
					depStatus === "present"
						? await probeOne(r, env)
						: { name: r.name, status: "missing", blockedBy: dep },
				);
			}),
	);
	return live.map((r) => first.get(r.name) as Presence);
}

// ─── installing ───────────────────────────────────────────────────────────────

export type InstallStep =
	| {
			kind: "argv";
			name: string;
			escalation: "none" | "sudo";
			argv: string[];
	  }
	| {
			kind: "uv-module";
			name: string;
			escalation: "none" | "sudo";
			script: string;
			module: string;
			args: string[];
	  }
	| {
			kind: "bootstrap";
			name: string;
			url: string;
			interpreter: "sh" | "bash";
			prefix: UserPrefix;
			/** The installer's environment, from {@link Bootstrap.env}. */
			env?: Record<string, string>;
	  }
	| {
			kind: "release";
			name: string;
			url: string;
			sha256: string;
			/** An archive to extract `binary` from, or the binary itself. */
			format: "tar.gz" | "binary";
			binary: string;
			dest: typeof LOCAL_PREFIX;
	  };

export function assertNever(value: never): never {
	throw new Error(`unhandled case: ${JSON.stringify(value)}`);
}

const platformOf = (env: Pick<ProbeEnv, "os" | "arch">): Platform =>
	`${env.os}_${env.arch}`;

/**
 * Why `option` cannot be used here, or null when it can. `has` answers whether
 * a tool is present or will be installed earlier in the same plan.
 */
export function optionBlocker(
	option: InstallOption,
	env: Pick<ProbeEnv, "os" | "arch">,
	has: (tool: string) => boolean,
): string | null {
	if (!appliesTo(option.os, env.os)) return `not for ${env.os}`;
	switch (option.via) {
		case "bun":
			return has("bun") ? null : "needs Bun";
		case "brew":
			return has("brew")
				? null
				: "Homebrew is missing — install it from https://brew.sh first";
		case "apt":
			return has("apt-get") ? null : "apt-get is not on this machine";
		case "release":
			return option.sha256[platformOf(env)]
				? null
				: `no pinned build for ${platformOf(env)}`;
		case "bootstrap": {
			const missing = TOOLCHAIN_BOOTSTRAP[option.tool].needs.filter(
				(tool) => !has(tool),
			);
			if (missing.length === 0) return null;
			const line =
				env.os === "darwin"
					? `brew install ${missing.join(" ")}`
					: `sudo apt-get install -y ${missing.join(" ")}`;
			return `its installer needs ${missing.join(", ")}: ${line}`;
		}
		case "uv-script":
		case "uv-module":
			return has("uv") ? null : "needs uv";
		case "npm":
			return has("npm") ? null : "needs npm";
		case "pip":
			return has("uv") ? null : "needs uv";
		case "go":
			return has("go") ? null : "needs Go";
		default:
			return assertNever(option);
	}
}

/** The first option usable here, in declaration order, or null. */
export function selectOption(
	r: Requirement,
	env: Pick<ProbeEnv, "os" | "arch">,
	has: (tool: string) => boolean,
): InstallOption | null {
	return r.install.find((o) => optionBlocker(o, env, has) === null) ?? null;
}

/** Why no option of `r` is usable here: each applicable option's blocker. */
export function whyUnselectable(
	r: Requirement,
	env: Pick<ProbeEnv, "os" | "arch">,
	has: (tool: string) => boolean,
): string {
	const reasons = r.install
		.filter((o) => appliesTo(o.os, env.os))
		.map((o) => optionBlocker(o, env, has))
		.filter((why): why is string => why !== null);
	return reasons.length > 0
		? [...new Set(reasons)].join("; ")
		: `no install option for ${env.os}`;
}

const pinned = (pkg: string, version?: string): string =>
	version ? `${pkg}@${version}` : pkg;

/**
 * `uv <sub…> --no-config --script <script>`: the one argv for a uv call that
 * builds or reads a plugin's script env. uv otherwise reads `uv.toml` and
 * `pyproject.toml` from the directory it runs in, which is the user's
 * project, so that project's index, Python preference or `offline` setting
 * would decide what the plugin imports, and every project reuses the env built
 * there. `uv` is the executable: the executor passes the one it resolved.
 */
export function uvScriptArgv(
	sub: string[],
	script: string,
	uv = "uv",
): string[] {
	return [uv, ...sub, "--no-config", "--script", script];
}

/** The one rendering of an option into the step that installs it. */
export function renderInstall(
	r: Requirement,
	option: InstallOption,
	env: Pick<ProbeEnv, "os" | "arch" | "pluginRoot">,
): InstallStep {
	const name = r.name;
	const argv = (args: string[], escalation: "none" | "sudo" = "none") =>
		({ kind: "argv", name, escalation, argv: args }) as const;
	switch (option.via) {
		case "bun":
			return argv(["bun", "add", "-g", pinned(option.package, option.version)]);
		case "brew":
			return argv(
				option.cask !== undefined
					? ["brew", "install", "--cask", option.cask]
					: ["brew", "install", option.formula],
			);
		case "apt":
			return argv(
				[
					"apt-get",
					"install",
					"-y",
					"--no-install-recommends",
					...option.packages,
				],
				"sudo",
			);
		case "release": {
			const platform = platformOf(env);
			const asset = releaseAsset(option, env.os, env.arch);
			const url = new URL(
				`https://github.com/${option.repo}/releases/download/${option.tag}/${asset}`,
			);
			return {
				kind: "release",
				name,
				url: url.href,
				sha256: option.sha256[platform] ?? "",
				format: releaseFormat(asset),
				binary: option.binary,
				dest: LOCAL_PREFIX,
			};
		}
		case "bootstrap": {
			const b: Bootstrap = TOOLCHAIN_BOOTSTRAP[option.tool];
			return {
				kind: "bootstrap",
				name,
				url: b.url,
				interpreter: b.interpreter,
				prefix: b.prefix,
				...(b.env ? { env: { ...b.env } } : {}),
			};
		}
		case "uv-script":
			return argv([
				...uvScriptArgv(["run"], join(env.pluginRoot, option.script)),
				...option.args,
			]);
		case "uv-module":
			return {
				kind: "uv-module",
				name,
				escalation: option.root ? "sudo" : "none",
				script: join(env.pluginRoot, option.script),
				module: option.module,
				args: option.args,
			};
		case "npm":
			return argv([
				"npm",
				"install",
				"-g",
				pinned(option.package, option.version),
			]);
		case "pip":
			return argv([
				"uv",
				"tool",
				"install",
				option.version
					? `${option.package}==${option.version}`
					: option.package,
			]);
		case "go":
			return argv([
				"go",
				"install",
				`${option.package}@${option.version ?? "latest"}`,
			]);
		default:
			return assertNever(option);
	}
}

/** Quote one word for display in a POSIX shell line. Display only. */
export function shellWord(word: string): string {
	return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(word)
		? word
		: `'${word.replaceAll("'", `'\\''`)}'`;
}

const shellLine = (argv: string[]): string => argv.map(shellWord).join(" ");

/**
 * The one human rendering of a step: a line a person can paste. Shown in the
 * hook banner, doctor, the TUI and /setup:project — never executed.
 */
export function describeStep(step: InstallStep, os: Os): string {
	switch (step.kind) {
		case "argv":
			return `${step.escalation === "sudo" ? "sudo " : ""}${shellLine(step.argv)}`;
		case "uv-module": {
			const sync = shellLine(uvScriptArgv(["sync"], step.script));
			const find = shellLine(uvScriptArgv(["python", "find"], step.script));
			const run = shellLine(["-B", "-m", step.module, ...step.args]);
			const sudo = step.escalation === "sudo" ? "sudo " : "";
			return `${sync} && ${sudo}"$(${find})" ${run}`;
		}
		case "bootstrap": {
			const env = Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`);
			const run =
				env.length > 0 ? ["env", ...env, step.interpreter] : [step.interpreter];
			return `curl -fsSL ${step.url} | ${shellLine(run)}`;
		}
		case "release": {
			const asset = step.url.slice(step.url.lastIndexOf("/") + 1);
			const verify = os === "darwin" ? "shasum -a 256 -c" : "sha256sum -c";
			const archive = step.format === "tar.gz";
			return [
				"cd $(mktemp -d)",
				`curl -fsSLO ${step.url}`,
				`echo '${step.sha256}  ${asset}' | ${verify}`,
				...(archive ? [`tar -xzf ${asset} ${step.binary}`] : []),
				`mkdir -p ${step.dest}`,
				`install -m 755 ${archive ? step.binary : asset} ${step.dest}/${step.binary}`,
			].join(" && ");
		}
		default:
			return assertNever(step);
	}
}

// ─── the report ───────────────────────────────────────────────────────────────

/** The install line magus-cli is installed with. */
export const MAGUS_CLI_INSTALL = "bun add -g magus-cli";

/**
 * The line that installs every plugin dependency, the one rendering of it.
 * Doctor reads the plugin set from the project it checks, so a line read
 * outside that project — the session banner, a remedy to run in a new
 * terminal — names it with `--project`. Null means "the directory you are in".
 */
export function doctorFixCommand(projectDir: string | null): string {
	return projectDir === null
		? "magus doctor --fix"
		: `magus doctor --fix --project ${shellWord(projectDir)}`;
}

/**
 * The banner text for one plugin, or null when nothing is missing or off PATH:
 * a healthy machine prints nothing. An `unknown` (a check that was too slow to
 * answer) is mentioned only beside a real finding, and never called missing.
 * `projectDir` is the directory the session runs in, when the hook input says.
 */
export function renderFix(
	plugin: string,
	presences: Presence[],
	reqs: Requirement[],
	env: ProbeEnv,
	magusOnPath: boolean,
	projectDir: string | null = null,
): string | null {
	const missing = presences.filter((p) => p.status === "missing");
	const offPath = presences.filter(
		(p): p is Extract<Presence, { status: "off-path" }> =>
			p.status === "off-path",
	);
	if (missing.length === 0 && offPath.length === 0) return null;
	const unknown = presences.filter(
		(p): p is Extract<Presence, { status: "unknown" }> =>
			p.status === "unknown",
	);
	const byName = new Map(reqs.map((r) => [r.name, r]));
	const shell = env.userShell ?? "";

	const names = (ps: Presence[]) =>
		ps
			.map((p) => p.name)
			.sort()
			.join(", ");
	const head: string[] = [];
	if (missing.length > 0) head.push(`missing ${names(missing)}`);
	if (offPath.length > 0) head.push(`not on PATH ${names(offPath)}`);
	if (unknown.length > 0) head.push(`unknown (slow) ${names(unknown)}`);
	const lines = [`magus-deps · ${plugin}: ${head.join("; ")}.`];
	lines.push(
		`  Fix all: ${magusOnPath ? "" : `${MAGUS_CLI_INSTALL}, then `}${doctorFixCommand(projectDir)}`,
	);

	// "present or installed earlier in the same fix": a declared dep counts.
	const has = (tool: string) =>
		byName.has(tool) || onPath(tool, env.path) !== null;
	const apt: string[] = [];
	const aptNames: string[] = [];
	const byHand: string[] = [];
	for (const p of [...missing].sort((a, b) => a.name.localeCompare(b.name))) {
		const r = byName.get(p.name);
		if (!r) continue;
		const option = selectOption(r, env, has);
		if (!option) {
			byHand.push(`${p.name}: ${whyUnselectable(r, env, has)}`);
			continue;
		}
		if (option.via === "apt") {
			apt.push(...option.packages);
			aptNames.push(p.name);
			continue;
		}
		const blocked =
			p.status === "missing" && p.blockedBy ? ` (after ${p.blockedBy})` : "";
		byHand.push(
			`${p.name}${blocked}: ${describeStep(renderInstall(r, option, env), env.os)}`,
		);
	}
	if (apt.length > 0) {
		// One apt line for every apt dep, rendered like any other step.
		const label = aptNames.join(", ");
		const merged = renderInstall(
			{ name: label, check: [], install: [] },
			{ via: "apt", packages: [...new Set(apt)] },
			env,
		);
		byHand.unshift(`${label}: ${describeStep(merged, env.os)}`);
	}
	if (byHand.length > 0) {
		lines.push("  Or by hand:");
		for (const line of byHand) lines.push(`    ${line}`);
	}
	for (const p of offPath) {
		const prefix = USER_PREFIXES.find((u) => u.dir === p.prefix);
		const rc = prefix?.rcLine(shell) ?? "";
		const adding = rcFileAdding(p.prefix, shell, env.home);
		lines.push(
			adding
				? `  ${p.name} is in ${p.prefix}, which is not on the PATH Claude Code started with; ${adding} already puts it on PATH`
				: `  ${p.name} is in ${p.prefix}, which is not on the PATH Claude Code started with: add ${rc} to ${rcFile(shell)}`,
		);
	}
	lines.push("  Then restart Claude Code from a new terminal.");
	return lines.join("\n");
}
