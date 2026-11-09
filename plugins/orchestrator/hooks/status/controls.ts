// What the band's and the panel's buttons do. Pane calls and SHOW go through the PressUi bound
// to the render dispatch that drew the button; effects through the Host. No engine interface
// spelled here.

import type { OrchestratorRow } from '../../types'
import { OTHER_MUX_NOTE, RUN_TIMEOUT_MS, SHOW_COLUMNS, SHOW_PANE_ID, SHOW_PANE_TITLE, SHOW_ROWS, assertNever } from './domain'
import { EMPTY_SCREEN, messageOf, type Host, type PressUi } from './host'
import { messageText } from './layout'
import { jumpPlan, openUrlArgvs, ownClientArgv, parseOwnClient, tmuxJumpSteps } from './mux'
import * as poll from './poll'

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, 160) ?? ''
}

/** Runs argv; null when it succeeded, else what went wrong in a line. */
async function runStep(host: Host, argv: readonly string[]): Promise<string | null> {
  const r = await host.run(argv, RUN_TIMEOUT_MS)
  if (r === null) return `${argv[0]} could not run`
  if (r.exitCode === 0) return null
  return firstLine(r.stderr) || firstLine(r.stdout) || `${argv.slice(0, 2).join(' ')} exited ${r.exitCode}`
}

/**
 * Jump: brings the row's pane to the front. tmux: across tmux sessions, `switch-client -c` with
 * this session's own client tty; then `select-window` and `select-pane` by id. herdr: `agent
 * focus`, then `tab focus` when that fails and the tab is known. A target in the other
 * multiplexer, or a step that fails, says so in a toast.
 */
export async function pressJump(host: Host, row: OrchestratorRow): Promise<void> {
  const env = await poll.envOf(host)
  const plan = jumpPlan(row.target, await poll.ownMux(host))
  switch (plan.kind) {
    case 'none':
      host.toast(`Jump ${row.label}: no pane recorded for this session`)
      return
    case 'unreachable':
      host.toast(`Jump ${row.label}: ${OTHER_MUX_NOTE}`)
      return
    case 'tmux': {
      let own: { tty: string; session: string } | null = null
      if (plan.session !== null && env.tmuxPane) {
        const r = await host.run(ownClientArgv(env.tmuxPane), RUN_TIMEOUT_MS)
        own = r !== null && r.exitCode === 0 ? parseOwnClient(r.stdout) : null
      }
      for (const argv of tmuxJumpSteps(plan, own)) {
        const failed = await runStep(host, argv)
        if (failed !== null) {
          host.toast(`Jump ${row.label}: ${failed}`, 8_000)
          return
        }
      }
      return
    }
    case 'herdr': {
      const failed = await runStep(host, plan.argv)
      if (failed === null) return
      const fallback = plan.fallback ? await runStep(host, plan.fallback) : failed
      if (fallback !== null) host.toast(`Jump ${row.label}: ${fallback}`, 8_000)
      return
    }
    default:
      assertNever(plan)
  }
}

/**
 * Show: opens the pane on one session (or moves the open pane to it), then captures its
 * screen. `ui.open` is the press's first call: the engine places a pane at any width only
 * while the person's press is behind it. An undrawn pane says why in a toast.
 */
export async function pressShow(ui: PressUi, host: Host, key: string): Promise<void> {
  const opening = ui.open(SHOW_PANE_ID, SHOW_PANE_TITLE, { columns: SHOW_COLUMNS, rows: SHOW_ROWS })
  await host.store.screen.update(s => (s.key === key && s.error === null ? s : EMPTY_SCREEN))
  await ui.setShow({ open: true, key, page: 0 })
  const opened = await opening
  if (!opened.isPlaced) host.toast(`Show: not drawn yet. ${opened.reason}`, 8_000)
  poll.captureNow(host)
}

/** More: opens the pane on the session list, which holds every family session. */
export async function pressMore(ui: PressUi, host: Host): Promise<void> {
  const opening = ui.open(SHOW_PANE_ID, SHOW_PANE_TITLE, { columns: SHOW_COLUMNS, rows: SHOW_ROWS })
  poll.stopCapture()
  await ui.setShow({ open: true, key: null, page: 0 })
  const opened = await opening
  if (!opened.isPlaced) host.toast(`More: not drawn yet. ${opened.reason}`, 8_000)
}

/** List, Prev, Next: the session list at a page. */
export async function pressList(ui: PressUi, page: number): Promise<void> {
  poll.stopCapture()
  await ui.setShow({ open: true, key: null, page: Math.max(0, page) })
}

/** Hide: puts the pane away. The ui.close hook marks SHOW closed and stops the capture loop. */
export async function pressHide(ui: PressUi): Promise<void> {
  await ui.close(SHOW_PANE_ID)
}

/** Open: the ticket in the browser, by the host's opener; the URL in a toast when none works. */
export async function pressOpen(host: Host, url: string): Promise<void> {
  for (const argv of openUrlArgvs(url)) {
    if ((await runStep(host, argv)) === null) return
  }
  host.toast(`Open: no browser opener ran; the ticket is ${url}`, 10_000)
}

/**
 * Msg: puts `SendMessage to <name>: ` in the prompt box, replacing what is there. A box that
 * did not take it (a dialog holds the keys) gets a toast with the text instead.
 */
export async function pressMsg(host: Host, name: string): Promise<void> {
  const text = messageText(name)
  let filled = false
  try {
    filled = await host.fill(text)
  } catch (err) {
    host.debug(`orchestrator Msg fill failed: ${messageOf(err)}`)
  }
  if (!filled) host.toast(`Msg: close the dialog first, then type: ${text}`, 8_000)
}
