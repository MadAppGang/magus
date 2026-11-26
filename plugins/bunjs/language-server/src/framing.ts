/**
 * LSP base-protocol framing: `Content-Length` headers, a blank line, a JSON
 * body. Frames come back with their exact bytes, so forwarding one is
 * byte-identical to forwarding the input.
 */

const MAX_HEADER_BYTES = 64 * 1024;
/** The largest body accepted; a larger declared length is not LSP from this client. */
export const MAX_BODY_BYTES = 256 * 1024 * 1024;
const decoder = new TextDecoder();

export interface Frame {
	bytes: Uint8Array;
	/** The JSON body, a view into the buffer of `bytes`. */
	body: Uint8Array;
	message: unknown;
}

export interface ParseResult {
	frames: Frame[];
	/** Set when the input is not LSP framing or a body is not JSON. */
	error: string | null;
	/** On error: every byte from the bad frame on, not yet returned in a frame. */
	rest: Uint8Array;
}

const EMPTY = new Uint8Array(0);

export function concat(parts: Uint8Array[]): Uint8Array {
	if (parts.length === 1) return parts[0] as Uint8Array;
	let length = 0;
	for (const p of parts) length += p.length;
	const out = new Uint8Array(length);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

function headerEnd(buf: Uint8Array): number {
	for (let i = 0; i + 3 < buf.length; i++) {
		if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
	}
	return -1;
}

function contentLength(header: string): number | string {
	let length: number | null = null;
	for (const line of header.split("\r\n")) {
		const m = /^([!-9;-~]+):[ \t]*(.*?)[ \t]*$/.exec(line);
		if (!m) return `malformed header line ${JSON.stringify(line.slice(0, 80))}`;
		if ((m[1] as string).toLowerCase() !== "content-length") continue;
		if (!/^\d{1,12}$/.test(m[2] as string)) return `bad Content-Length ${JSON.stringify(m[2])}`;
		if (length !== null) return "more than one Content-Length header";
		length = Number(m[2]);
		if (length > MAX_BODY_BYTES) return `Content-Length ${length} is over ${MAX_BODY_BYTES} bytes`;
	}
	return length ?? "no Content-Length header";
}

export class FrameParser {
	private head: Uint8Array = EMPTY;
	private parts: Uint8Array[] = [];
	private have = 0;
	/** Total bytes of the frame being collected; 0 while reading headers. */
	private need = 0;
	private bodyAt = 0;
	/** Leading bytes of the current frame that were already delivered. */
	private skip = 0;

	/** Whether an incomplete frame is buffered. */
	get partial(): boolean {
		return this.need > 0 ? this.have > 0 : this.head.length > 0;
	}

	/**
	 * Treats what is buffered as already delivered elsewhere: the frame that
	 * completes it is returned without those leading bytes.
	 */
	markDelivered(): void {
		this.skip = this.need > 0 ? this.have : this.head.length;
	}

	private buffered(): Uint8Array {
		return this.need > 0 ? concat(this.parts) : this.head;
	}

	private fail(error: string, frames: Frame[], input: Uint8Array): ParseResult {
		const rest = concat([this.buffered().subarray(this.skip), input]);
		this.head = EMPTY;
		this.parts = [];
		this.have = 0;
		this.need = 0;
		this.skip = 0;
		return { frames, error, rest };
	}

	push(chunk: Uint8Array): ParseResult {
		const frames: Frame[] = [];
		let input = chunk;
		for (;;) {
			if (this.need === 0) {
				if (input.length === 0) return { frames, error: null, rest: EMPTY };
				const buf = this.head.length > 0 ? concat([this.head, input]) : input;
				input = EMPTY;
				const end = headerEnd(buf);
				if (end < 0) {
					this.head = buf;
					// Up to 3 bytes of a split delimiter may follow a header of the full size.
					if (buf.length > MAX_HEADER_BYTES + 3) return this.fail("header longer than 64 KiB", frames, EMPTY);
					return { frames, error: null, rest: EMPTY };
				}
				if (end > MAX_HEADER_BYTES) {
					this.head = buf;
					return this.fail("header longer than 64 KiB", frames, EMPTY);
				}
				const length = contentLength(decoder.decode(buf.subarray(0, end)));
				if (typeof length === "string") {
					this.head = buf;
					return this.fail(length, frames, EMPTY);
				}
				this.head = EMPTY;
				this.bodyAt = end + 4;
				this.need = this.bodyAt + length;
				this.parts = [buf];
				this.have = buf.length;
			} else if (input.length > 0) {
				this.parts.push(input);
				this.have += input.length;
				input = EMPTY;
			}
			if (this.have < this.need) return { frames, error: null, rest: EMPTY };

			const all = concat(this.parts);
			const bytes = all.subarray(0, this.need);
			const body = bytes.subarray(this.bodyAt);
			let message: unknown;
			try {
				message = JSON.parse(decoder.decode(body));
			} catch {
				this.parts = [all];
				return this.fail("body is not JSON", frames, EMPTY);
			}
			frames.push({ bytes: this.skip > 0 ? bytes.subarray(this.skip) : bytes, body, message });
			input = all.subarray(this.need);
			this.parts = [];
			this.have = 0;
			this.need = 0;
			this.skip = 0;
		}
	}
}

function asObject(message: unknown): Record<string, unknown> | null {
	return message !== null && typeof message === "object" && !Array.isArray(message)
		? (message as Record<string, unknown>)
		: null;
}

/** The pending key of a request (`id` and `method`), else null. */
export function requestKey(message: unknown): string | null {
	const m = asObject(message);
	return m && "id" in m && typeof m.method === "string" ? JSON.stringify(m.id) : null;
}

/** The pending key a response (`id`, no `method`) settles, else null. */
export function responseKey(message: unknown): string | null {
	const m = asObject(message);
	return m && "id" in m && !("method" in m) ? JSON.stringify(m.id) : null;
}

export function methodOf(message: unknown): string | null {
	const m = asObject(message);
	return m && typeof m.method === "string" ? m.method : null;
}

/**
 * Whether a server could read this message as `exit`. Go's JSON decoder
 * matches field names case-insensitively, so `Method` or `METHOD` counts too.
 */
export function isExit(message: unknown): boolean {
	const m = asObject(message);
	if (!m) return false;
	return Object.keys(m).some((key) => key.toLowerCase() === "method" && m[key] === "exit");
}

const JSON_SPACE = new Set([" ", "\t", "\n", "\r"]);

/** The keys at the top level of a JSON object text, decoded, duplicates kept. */
function topLevelKeys(text: string): string[] {
	const keys: string[] = [];
	let depth = 0;
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '"') {
			const start = i++;
			while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
			i++;
			if (depth === 1) {
				let j = i;
				while (JSON_SPACE.has(text[j] as string)) j++;
				if (text[j] === ":") keys.push(JSON.parse(text.slice(start, i)) as string);
			}
			continue;
		}
		if (c === "{" || c === "[") depth++;
		else if (c === "}" || c === "]") depth--;
		i++;
	}
	return keys;
}

/**
 * Why a server could read this frame's `method` differently from the wrapper,
 * else null. JSON.parse keeps only the last of duplicate keys, while Go matches
 * `method` case-insensitively and skips a `null` for a string field, so two
 * method keys, or a method that is not a string, make the frame ambiguous.
 */
export function methodProblem(frame: Frame): string | null {
	const m = asObject(frame.message);
	if (!m) return null;
	const named = Object.keys(m).filter((key) => key.toLowerCase() === "method");
	if (named.some((key) => typeof m[key] !== "string")) return "a method field that is not a string";
	const count = topLevelKeys(decoder.decode(frame.body)).filter((key) => key.toLowerCase() === "method").length;
	return count > 1 ? "more than one method field" : null;
}
