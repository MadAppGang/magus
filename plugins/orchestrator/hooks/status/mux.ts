// Pure: everything the mod says to tmux and herdr, as argv, and how it reads their answers. The
// `ps` argv and its parser live in state-core.ts, shared with the store. No IO: poll.ts and
// controls.ts run the argv through the host.

import type { OrchestratorRecord, OrchestratorTarget } from '../../types'
import { parseTmuxField } from '../../scripts/lib/state-core'
import type { SessionFile } from './model'

/** The multiplexer this session runs in, by the launcher's rule: herdr wins, since it inherits TMUX. */
export type OwnMux = 'tmux' | 'herdr' | 'none'

/** The environment fields the multiplexer rule reads. */
export type MuxEnv = { tmuxPane?: string; herdrEnv?: string; herdrPane?: string; multiplexer?: string }

/**
 * `ORCHESTRATOR_MULTIPLEXER` forces either; otherwise herdr when `HERDR_ENV=1` and
 * `HERDR_PANE_ID` is set, else tmux when `TMUX_PANE` is set, else none.
 */
export function ownMuxOf(env: MuxEnv): OwnMux {
  const herdr = typeof env.herdrPane === 'string' && env.herdrPane !== ''
  const tmux = typeof env.tmuxPane === 'string' && env.tmuxPane !== ''
  if (env.multiplexer === 'tmux') return tmux ? 'tmux' : 'none'
  if (env.multiplexer === 'herdr') return herdr ? 'herdr' : 'none'
  if (env.herdrEnv === '1' && herdr) return 'herdr'
  return tmux ? 'tmux' : 'none'
}

/**
 * Where a session can be reached: herdr when the record carries herdr ids, else tmux from the
 * session file's `tmux` field, else null. herdr wins because it inherits `TMUX` inside tmux,
 * so the tmux field would name herdr's host pane.
 */
export function targetOf(record: Pick<OrchestratorRecord, 'herdr'>, file: Pick<SessionFile, 'tmux'> | null): OrchestratorTarget | null {
  if (record.herdr && record.herdr.pane !== '') return { mux: 'herdr', pane: record.herdr.pane, tab: record.herdr.tab }
  const t = file?.tmux ? parseTmuxField(file.tmux) : null
  return t ? { mux: 'tmux', pane: t.pane, window: t.window, session: t.session } : null
}

/** How a Jump goes: nowhere to go, the other multiplexer, or a plan for this one. */
export type JumpPlan =
  | { kind: 'none' }
  | { kind: 'unreachable' }
  | { kind: 'tmux'; pane: string; window: string | null; session: string | null }
  | { kind: 'herdr'; argv: string[]; fallback: string[] | null }

export function jumpPlan(target: OrchestratorTarget | null, own: OwnMux): JumpPlan {
  if (target === null) return { kind: 'none' }
  if (target.mux !== own) return { kind: 'unreachable' }
  if (target.mux === 'tmux') return { kind: 'tmux', pane: target.pane, window: target.window, session: target.session }
  return {
    kind: 'herdr',
    argv: ['herdr', 'agent', 'focus', target.pane],
    fallback: target.tab ? ['herdr', 'tab', 'focus', target.tab] : null,
  }
}

/** Asks tmux for this session's client tty and tmux session: by the own pane, never the active one. */
export function ownClientArgv(ownPane: string): string[] {
  return ['tmux', 'display-message', '-p', '-t', ownPane, '#{client_tty}\t#{session_name}']
}

/** `ownClientArgv`'s answer: the client tty and the session name, or null when it does not read. */
export function parseOwnClient(stdout: string): { tty: string; session: string } | null {
  const line = stdout.split('\n')[0] ?? ''
  const [tty, session] = line.split('\t')
  if (!tty || !session) return null
  return { tty: tty.trim(), session: session.trim() }
}

/**
 * The tmux calls of a Jump, in order: `switch-client -c <own tty>` when the target lives in
 * another tmux session (a background process has no current client, so never without `-c`),
 * then `select-window` and `select-pane`, both on the target's pane id (tmux resolves a pane id
 * to the window holding it, so a window id that went stale cannot misdirect the jump).
 */
export function tmuxJumpSteps(plan: Extract<JumpPlan, { kind: 'tmux' }>, own: { tty: string; session: string } | null): string[][] {
  const steps: string[][] = []
  if (plan.session !== null && own !== null && own.session !== plan.session) {
    steps.push(['tmux', 'switch-client', '-c', own.tty, '-t', plan.session])
  }
  steps.push(['tmux', 'select-window', '-t', plan.pane])
  steps.push(['tmux', 'select-pane', '-t', plan.pane])
  return steps
}

/** The visible screen of a target as plain text (tmux keeps trailing spaces with -N). */
export function captureArgv(target: OrchestratorTarget): string[] {
  return target.mux === 'tmux'
    ? ['tmux', 'capture-pane', '-p', '-N', '-t', target.pane]
    : ['herdr', 'pane', 'read', target.pane, '--source', 'visible', '--format', 'text']
}

/** Opens a URL with the host's opener: `open` on macOS, then `xdg-open` elsewhere. */
export function openUrlArgvs(url: string): string[][] {
  return [['open', url], ['xdg-open', url]]
}
