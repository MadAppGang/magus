/**
 * Idle bookkeeping, with no timers of its own: the caller supplies the clock
 * and decides when to ask.
 *
 * Activity is the start, every raw client chunk, and the moment the last
 * pending request is answered. The server is idle when no activity happened
 * for `idleMs`, no request is pending, and no client frame is half received.
 * A candidate is confirmed only on a later recheck with no chunk in between,
 * so a chunk that arrives while the stop is being decided cancels it.
 */

export interface IdleMark {
	readonly chunks: number;
}

export class IdleTracker {
	private lastActivity: number;
	private readonly pending = new Set<string>();
	private partial = false;
	private disabled: boolean;
	private chunks = 0;

	constructor(
		readonly idleMs: number,
		private readonly now: () => number,
	) {
		this.lastActivity = now();
		this.disabled = !(idleMs > 0);
	}

	get enabled(): boolean {
		return !this.disabled;
	}

	get pendingCount(): number {
		return this.pending.size;
	}

	/** Stops idle detection for good (raw relay, unreadable server output). */
	disable(): void {
		this.disabled = true;
	}

	/** A raw client chunk, counted before it is parsed. */
	chunk(): void {
		this.lastActivity = this.now();
		this.chunks++;
	}

	/** A client message with both `id` and `method`; key is JSON.stringify(id). */
	request(key: string): void {
		this.pending.add(key);
	}

	/** A server message with `id` and no `method`. */
	response(key: string): void {
		if (this.pending.delete(key) && this.pending.size === 0) this.lastActivity = this.now();
	}

	/** Whether the client parser holds an incomplete frame. */
	setPartial(partial: boolean): void {
		this.partial = partial;
	}

	/**
	 * Milliseconds until the idle deadline, ≤ 0 once it has passed; null when
	 * idle stop is off.
	 */
	remainingMs(): number | null {
		if (this.disabled) return null;
		return this.lastActivity + this.idleMs - this.now();
	}

	candidate(): IdleMark | null {
		if (this.disabled || this.pending.size > 0 || this.partial) return null;
		if (this.now() - this.lastActivity < this.idleMs) return null;
		return { chunks: this.chunks };
	}

	/** True when still a candidate and no chunk arrived since `mark`. */
	recheck(mark: IdleMark): boolean {
		return this.candidate() !== null && this.chunks === mark.chunks;
	}
}
