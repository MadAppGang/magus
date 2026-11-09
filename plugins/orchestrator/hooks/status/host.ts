// The shapes register.tsx fills with closures over a dispatch's engine interface. No
// engine-interface spelling and no state reference live here: the engine's static scan reads
// a state reference only where its plugin and key are literals of the file that uses it, and
// follows the engine interface into no import.

import type { Timer, UiOpenResult, UiPane } from 'claude-code'
import type { OrchestratorRowsState, OrchestratorScreenState, OrchestratorShowState } from '../../types'

/** One atom, through closures over one dispatch. */
export type Cell<T> = {
  read(): Promise<T>
  /** resolves what it wrote */
  update(fn: (v: T) => T): Promise<T>
}

export type Store = {
  rows: Cell<OrchestratorRowsState>
  show: Cell<OrchestratorShowState>
  screen: Cell<OrchestratorScreenState>
}

/** The environment the mod reads, one field per variable. Absent = unset or refused. */
export type OrchestratorEnv = {
  home?: string
  claudeConfigDir?: string
  stateDir?: string
  tmuxPane?: string
  herdrEnv?: string
  herdrPane?: string
  multiplexer?: string
}

export type RunResult = { exitCode: number; stdout: string; stderr: string }

/** Everything timer code may do, bound by the first hook after a load. */
export type Host = {
  store: Store
  now(): Promise<number>
  after(ms: number, fn: () => void): Timer
  env(): Promise<OrchestratorEnv>
  /** a directory's entry names; [] when missing or refused */
  list(dir: string): Promise<readonly { name: string }[]>
  /** a file's text; null when missing or refused */
  read(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  /** null when the command could not start, timed out, or was refused */
  run(argv: readonly string[], timeoutMs: number): Promise<RunResult | null>
  /** this conversation's id, which changes on /clear */
  sessionId(): Promise<string>
  toast(text: string, timeoutMs?: number): void
  /** replaces the prompt box's text; false when no box took it (a dialog holds the keys) */
  fill(text: string): Promise<boolean>
  debug(text: string): void
  /** redraws every ui.render of the mod */
  invalidate(): void
  panes(): Promise<readonly UiPane[]>
}

/**
 * The pane calls a press makes, bound to the render dispatch whose tree held the button: the
 * engine places a pane at any width only while the person's press is behind its open.
 */
export type PressUi = {
  open(id: string, title: string, size: { columns: number; rows: number }): Promise<UiOpenResult>
  close(id: string): Promise<void>
  panes(): Promise<readonly UiPane[]>
  /** writes SHOW on the press's own dispatch */
  setShow(value: OrchestratorShowState): Promise<void>
}

const MAX_PASSES = 8

/** The fn an update retries, throwing once it has been asked more than MAX_PASSES times. */
export function capped<T>(fn: (v: T) => T): (v: T) => T {
  let passes = 0
  return v => {
    passes += 1
    if (passes > MAX_PASSES) throw new Error(`state update did not converge in ${MAX_PASSES} passes`)
    return fn(v)
  }
}

export const CLOSED_SHOW: OrchestratorShowState = { open: false, key: null, page: 0 }
export const EMPTY_SCREEN: OrchestratorScreenState = { key: null, lines: [], at: 0, error: null, misses: 0 }
export const EMPTY_ROWS: OrchestratorRowsState = { at: 0, selfKey: null, rows: [] }

/** An error's message, short, for a toast or the debug log. */
export function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.slice(0, 200)
}
