import { execSync } from "node:child_process";

/**
 * Write text to the system clipboard.
 * macOS: uses pbcopy
 * Linux: uses xclip
 * Throws ClipboardUnavailableError if no clipboard tool is available.
 */
export async function writeClipboard(text: string): Promise<void> {
	if (process.platform === "darwin") {
		execSync("pbcopy", { input: text });
	} else if (process.platform === "linux") {
		execSync("xclip -selection clipboard", { input: text });
	} else {
		throw new ClipboardUnavailableError(
			`Clipboard not supported on platform: ${process.platform}`,
		);
	}
}

/**
 * Read text from the system clipboard.
 * macOS: uses pbpaste
 * Linux: uses xclip
 * Throws ClipboardUnavailableError if no clipboard tool is available.
 */
export async function readClipboard(): Promise<string> {
	if (process.platform === "darwin") {
		return execSync("pbpaste").toString();
	} else if (process.platform === "linux") {
		return execSync("xclip -selection clipboard -o").toString();
	} else {
		throw new ClipboardUnavailableError(
			`Clipboard not supported on platform: ${process.platform}`,
		);
	}
}

export class ClipboardUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClipboardUnavailableError";
	}
}

/** Check if clipboard operations are available on this platform/system */
export function isClipboardAvailable(): boolean {
	if (process.platform === "darwin") return true;
	if (process.platform === "linux") {
		try {
			execSync("which xclip", { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	}
	return false;
}
