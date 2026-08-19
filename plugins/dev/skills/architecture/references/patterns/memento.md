# Memento

**Intent:** capture an object's internal state so it can be restored later, without
violating encapsulation.

## The force

Undo needs the previous state. The naive route is to expose every field so a caller can copy
them, which destroys encapsulation and couples the caller to the internals forever:

```ts
// Now the history class knows every field of Editor, and breaks whenever one is added.
history.push({ text: editor.text, cursor: editor.cursor, selection: editor.selection });
```

Memento lets the object produce and consume its own snapshot, so only it knows what is in it.

## Structure

```ts
// Opaque to everyone except its originator.
class EditorMemento {
  constructor(
    readonly #text: string,       // private: the caretaker cannot read these
    readonly #cursor: number,
  ) {}
  // No public getters. Deliberately.
}

class Editor {
  #text = "";
  #cursor = 0;

  save(): EditorMemento { return new EditorMemento(this.#text, this.#cursor) }
  restore(m: EditorMemento): void { ({ text: this.#text, cursor: this.#cursor } = m.read()) }
}

// The caretaker stores mementos and never inspects them.
class History {
  #stack: EditorMemento[] = [];
  backup(e: Editor) { this.#stack.push(e.save()) }
  undo(e: Editor)   { const m = this.#stack.pop(); if (m) e.restore(m) }
}
```

**Three roles, and the separation is the pattern:** the *originator* (Editor) creates and
consumes snapshots, the *memento* is opaque state, and the *caretaker* (History) stores them
without ever looking inside. The caretaker's ignorance is what keeps encapsulation intact.

## Does TypeScript already do this

TypeScript has no true friend-class access, so full opacity is a convention rather than a
guarantee. The idiomatic approaches:

```ts
// 1. Snapshot as immutable data. Simple, and usually enough.
type EditorSnapshot = Readonly<{ text: string; cursor: number }>;
class Editor {
  snapshot(): EditorSnapshot { return Object.freeze({ text: this.#text, cursor: this.#cursor }) }
  restore(s: EditorSnapshot) { this.#text = s.text; this.#cursor = s.cursor }
}

// 2. Immutable state. The "memento" is just the previous value; undo is a pointer move.
const history: State[] = [];
const next = { ...state, text: newText };   // old state is still valid and untouched
history.push(state);
```

**Option 2 is the one to reach for.** With immutable state, every previous value is already
a memento, and undo is `history.pop()`. It removes the pattern entirely.

**Do not cite Redux DevTools as an example of this.** It is Command, not Memento: the action
log is the source of truth, and `recomputeStates()` re-runs the reducer over that log to
rebuild each state. Jumping to a point moves an index into the derived cache. Redux's own
undo guide cites Command and never uses the word "memento". The same holds for every major
JS undo implementation checked — ProseMirror stores inverted steps, Yjs stores reverse
operations, Excalidraw stores deltas.

**Real snapshot-based examples do exist**, and they say so:
- **Spring Web Flow** — *"State management employs the GOF Memento pattern"*; API is
  `createMessagesMemento()` / `restoreMessages()`, and it names the caretaker role. Apache-2.0.
- **`pdfarranger`** explains the trade-off that decides between the two:
  *"The memento pattern is simpler than the command pattern. Here the memory cost of memento
  is affordable because we only store snapshots of the GtkListStore object, not of the whole
  PDF files."* Snapshots win when the snapshot is small. GPL-3.0 — read, do not copy.
- `redux-undo` (MIT) genuinely stores past/present/future state values, but never claims the
  pattern. Shape without a citation.

## Trade-offs

| Gain | Cost |
|---|---|
| Snapshots without exposing internals | Memory grows with history depth; large objects snapshotted often are expensive |
| The originator controls what a snapshot contains | A caretaker must decide when to discard old mementos |
| Undo/redo becomes a stack | Deep copies are needed; shallow snapshots share mutable references and silently corrupt history |

**The deep-copy trap is the real bug.** A snapshot that copies a reference to a mutable array
does not preserve anything: mutating the original also changes the "snapshot". Either freeze,
deep copy (`structuredClone`), or use immutable state.

## When NOT to use this

- **State is immutable.** You already have mementos for free.
- **The operation can be inverted arithmetically.** `command.md`'s `undo()` computing the
  reverse is cheaper than storing snapshots.
- **The object is large and changes often.** Snapshot memory becomes the dominant cost;
  consider storing deltas or snapshotting every N operations.
- **Only one level of undo is needed.** One saved copy is not a pattern.

## Relations

- **Command** (`command.md`) is the usual partner: the command holds a memento taken before
  `execute()` and restores it in `undo()`.
- **Prototype** (`prototype.md`) also copies state, but to produce an independent new object
  rather than to restore the same one.
- At system scale, `../styles/cqrs-event-sourcing.md` replaces snapshots with a log of events
  and rebuilds state by replay; its "snapshots" optimization is this pattern at scale.
