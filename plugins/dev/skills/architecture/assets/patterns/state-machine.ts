/**
 * State, as a typed transition table.
 *
 * See references/patterns/state.md. The class-per-state form is there too; take this one
 * when states differ only in WHICH TRANSITIONS ARE LEGAL, and the class form when each
 * state also carries substantially different behaviour and data.
 *
 * The advantage of the table: the entire machine is readable in one place, which is the
 * thing the class-per-state form gives up.
 */

/** A transition table: from-state -> action -> to-state. */
export type Transitions<S extends string, A extends string> = Readonly<
  Record<S, Partial<Readonly<Record<A, S>>>>
>;

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly action: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `cannot "${action}" from "${from}"; allowed here: ${allowed.join(", ") || "(none)"}`,
    );
    this.name = "IllegalTransitionError";
  }
}

/**
 * A machine that refuses illegal transitions instead of silently ignoring them.
 *
 * Silently ignoring is the failure state.md warns about: the document stays in `draft`,
 * the UI shows success, and nobody finds out until someone asks why nothing published.
 */
export class StateMachine<S extends string, A extends string> {
  #current: S;

  constructor(
    private readonly table: Transitions<S, A>,
    initial: S,
  ) {
    if (!(initial in table)) {
      throw new Error(`initial state "${initial}" is not in the transition table`);
    }
    this.#current = initial;
  }

  get state(): S {
    return this.#current;
  }

  /** Which actions are legal right now. Useful for enabling/disabling UI. */
  allowed(): readonly A[] {
    return Object.keys(this.table[this.#current] ?? {}).sort() as A[];
  }

  can(action: A): boolean {
    return this.table[this.#current]?.[action] !== undefined;
  }

  /** Applies the transition, or throws. Never a silent no-op. */
  apply(action: A): S {
    const to = this.table[this.#current]?.[action];
    if (to === undefined) {
      throw new IllegalTransitionError(this.#current, action, this.allowed());
    }
    this.#current = to;
    return to;
  }

  /** Non-throwing variant for callers that legitimately probe. */
  tryApply(action: A): { ok: true; state: S } | { ok: false; reason: string } {
    try {
      return { ok: true, state: this.apply(action) };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
