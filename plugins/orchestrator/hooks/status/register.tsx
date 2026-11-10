// The composition root of the orchestrator status mod: every atom and every engine-interface
// call the mod makes is spelled here, because the engine's static scan follows the interface
// into no imported function and reads a state reference only where its plugin and key are
// literals of the file using it. Nothing here decides anything beyond wiring.
//
// Outside an orchestrated family the mod draws nothing: the band passes (`next(e)`) and the
// loop does one existence check of this session's index entry every 5 s, nothing more.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'
import type { OrchestratorRow } from '../../types'
import { SHOW_PANE_ID } from './domain'
import { CLOSED_SHOW, EMPTY_SCREEN, capped, messageOf, type Host, type PressUi } from './host'
import { bandModel, listModel, panelFit, screenNote, sessionModel } from './layout'
import { bandTree, type BandActions } from './band'
import { panelTree, type PanelActions } from './panel'
import * as controls from './controls'
import { herdrFallbackArgv } from './mux'
import * as poll from './poll'

// The three atoms. plugin and key are literals HERE: the scan reads no reference from another file.
const ROWS = atom({ plugin: 'orchestrator', key: 'rows' } as const, { at: 0, selfKey: null, rows: [] })
const SHOW = atom({ plugin: 'orchestrator', key: 'show' } as const, { open: false, key: null, page: 0 })
const SCREEN = atom({ plugin: 'orchestrator', key: 'screen' } as const, { key: null, lines: [], at: 0, error: null, misses: 0 })

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

// True once herdr answered at its fallback path: later calls go straight there.
let herdrAtFallback = false

// The interface itself may not be kept, so each effect is one closure spelling it out.
function bindHost($: EngineInterface): Host {
  return {
    store: {
      rows: { read: () => read($, ROWS), update: fn => update($, ROWS, capped(fn)) },
      show: { read: () => read($, SHOW), update: fn => update($, SHOW, capped(fn)) },
      screen: { read: () => read($, SCREEN), update: fn => update($, SCREEN, capped(fn)) },
    },
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    // one literal read per variable, so `claude plugin validate` lists every one
    env: async () => ({
      home: text(await $.env.get('HOME')),
      claudeConfigDir: text(await $.env.get('CLAUDE_CONFIG_DIR')),
      stateDir: text(await $.env.get('ORCHESTRATOR_STATE_DIR')),
      tmuxPane: text(await $.env.get('TMUX_PANE')),
    }),
    list: dir => $.fs.list(dir).then(entries => entries.map(e => ({ name: e.name })), () => []),
    read: path => $.fs.read(path).then(t => (typeof t === 'string' ? t : null), () => null),
    exists: path => $.fs.exists(path).catch(() => false),
    run: async (argv, timeoutMs) => {
      const exec = (a: readonly string[]) =>
        $.process.run(a, { timeoutMs }).then(r => ({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }), () => null)
      const fallback = argv[0] === 'herdr' ? herdrFallbackArgv(argv, text(await $.env.get('HOME'))) : null
      if (fallback !== null && herdrAtFallback) return exec(fallback)
      const first = await exec(argv)
      if (first !== null || fallback === null) return first
      const second = await exec(fallback)
      if (second !== null) herdrAtFallback = true
      return second
    },
    sessionId: () => $.session.id(),
    toast: (msg, timeoutMs) => $.ui.toast(msg, timeoutMs === undefined ? undefined : { timeoutMs }),
    fill: msg => $.prompt.fill({ text: msg, mode: 'replace' }).then(r => r.isFilled, () => false),
    debug: msg => $.ui.log(msg, { to: 'debug' }),
    invalidate: () => $.ui.invalidate('ui.render'),
    panes: () => $.ui.panes(),
  }
}

// A press's pane calls and its SHOW write, spelled on the render dispatch that drew the button:
// the person's press is then behind the open, so the engine places the pane at any width.
function bindPressUi($: EngineInterface): PressUi {
  return {
    open: (id, title, size) => $.ui.open({ id, title, columns: size.columns, rows: size.rows, closeOnEscape: true }),
    close: id => $.ui.close({ id }),
    panes: () => $.ui.panes(),
    setShow: value => update($, SHOW, () => value).then(() => undefined),
  }
}

/** The row presses shared by the band and the pane, each looking its row up by key. */
function rowActions(host: Host, ui: PressUi, rows: readonly OrchestratorRow[]): PanelActions & BandActions {
  const find = (key: string) => rows.find(r => r.key === key)
  const fail = (what: string) => (err: unknown) => host.debug(`orchestrator ${what} failed: ${messageOf(err)}`)
  return {
    jump: key => {
      const row = find(key)
      if (row) void controls.pressJump(host, row).catch(fail('Jump'))
    },
    show: key => void controls.pressShow(ui, host, key).catch(fail('Show')),
    open: key => {
      const url = find(key)?.ticket?.url
      if (url) void controls.pressOpen(host, url).catch(fail('Open'))
    },
    msg: key => {
      const name = find(key)?.name
      if (name) void controls.pressMsg(host, name).catch(fail('Msg'))
    },
    more: () => void controls.pressMore(ui, host).catch(fail('More')),
    list: page => void controls.pressList(ui, page).catch(fail('List')),
    hide: () => void controls.pressHide(ui).catch(fail('Hide')),
  }
}

export const register: Register = on => {
  // Closures over the first dispatch after a load. A hot reload fires no session.start, so the
  // first render after it binds the host and restarts the loop.
  let host: Host | null = null

  on('session.start', async ($, e, next) => {
    host ??= bindHost($)
    // atoms survive reloads: what the pane showed before is not this session's any more
    await update($, SHOW, () => CLOSED_SHOW)
    await update($, SCREEN, () => EMPTY_SCREEN)
    poll.stopCapture()
    poll.ensureLoop(host)
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    host ??= bindHost($)
    poll.ensureLoop(host)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A /clear or a resume keeps the process and the family key; the screen of the old
  // conversation is dropped, and the next tick re-reads the self key under the new id.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, SCREEN, () => EMPTY_SCREEN)
      if (host) poll.kick(host)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band. Every read comes before any early return, so a later write wakes it even while it
  // draws nothing (a session that registers mid-way gets its band on the next tick).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    host ??= bindHost($)
    poll.ensureLoop(host)
    const state = await read($, ROWS)
    await read($, SHOW)
    const panes = await $.ui.panes()
    if (e.props.hasSurvey || state.selfKey === null || state.rows.length === 0) return next(e)
    const panelOpen = panes.some(p => p.id === SHOW_PANE_ID && p.isPlaced)
    const model = bandModel(state.rows, e.props.bodyColumns, e.props.maxRows, panelOpen, await $.clock.now())
    if (model === null) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return bandTree({ Box, Text, Button }, model, rowActions(host, bindPressUi($), state.rows))
  })

  // The pane: the session list, or one session with its screen.
  on('ui.render', { component: 'Pane', requestId: SHOW_PANE_ID }, async ($, e, next) => {
    host ??= bindHost($)
    poll.ensureLoop(host)
    const state = await read($, ROWS)
    const show = await read($, SHOW)
    const screen = await read($, SCREEN)
    const fit = panelFit(e.props)
    const now = await $.clock.now()
    const row = show.key === null ? undefined : state.rows.find(r => r.key === show.key)
    const own = await poll.ownMux(host)
    const model = row ? sessionModel(row, screen, fit, own, now) : listModel(state.rows, fit, show.page, now)
    if (row && screenNote(row, own) === null) poll.ensureCapture(host)
    const { Box, Text, Button } = $.ui.resolve(e)
    const tree: RenderElement = panelTree({ Box, Text, Button }, model, fit.columns, rowActions(host, bindPressUi($), state.rows))
    return tree
  })

  // A gating hook: the close goes through first, then the pane is marked closed.
  on('ui.close', { id: SHOW_PANE_ID }, async ($, e, next) => {
    const r = await next(e)
    await update($, SHOW, () => CLOSED_SHOW)
    poll.stopCapture()
    return r
  }).catch(($, e, next) => next(e))
}
