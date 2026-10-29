// The composition root of the claudish status mod: every atom and every engine-interface
// call the mod makes is spelled here, because the engine's static scan follows the
// interface into no imported function and reads a state reference only where its plugin
// and key are literals of the file using it. Nothing here decides anything beyond wiring:
// poll, wake and the adapter take values and the closures bound below.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { CLAUDISH_TOOL, makeClaudishSource, type McpCall } from './claudish-source'
import { isCodexSession, makeAllowanceSource } from './allowance-source'
import { capped, claimVia, rejected, toAccepted, type Host, type PressUi, type Store } from './host'
import { CLIENT_SURFACES, FORECAST_PANE_ID, FORECAST_PANE_TITLE, SHOW_PANE_ID } from './domain'
import { activeTab, bandModel, childSize, paneAgentRows, paneFit, paneModel, showTabs, wrapTabs } from './layout'
import * as poll from './poll'
import * as allowancePoll from './allowance-poll'
import * as wake from './wake'
import * as controls from './controls'
import { bandTree, type TimelineLook } from './band'
import { allowanceRow } from './allowance-row'
import { allowanceRowTree, forecastTree } from './allowance'
import { panelLines } from './forecast'
import { DARK_PALETTE, TMUX_THEME_FORMAT, paletteFor, tmuxClientAppearance, type Appearance, type Palette } from './palette'
import { panelTree } from './pane'

// The nine atoms. plugin and key are literals HERE: the scan reads no reference from another file.
const RUNS = atom({ plugin: 'claudish', key: 'runs' } as const, { epoch: 0, starts: {}, list: [] })
const FEEDS = atom({ plugin: 'claudish', key: 'feeds' } as const, {})
const STOP_REQUESTS = atom({ plugin: 'claudish', key: 'stopRequests' } as const, {})
const PANES = atom({ plugin: 'claudish', key: 'panes' } as const, null) // a family: members by memberOf
const LEDGER = atom({ plugin: 'claudish', key: 'wakeLedger' } as const, { epoch: 0, entries: {} })
const TURN = atom({ plugin: 'claudish', key: 'turn' } as const, { isRunning: false, since: 0 })
const EARLIER = atom({ plugin: 'claudish', key: 'earlier' } as const, { runs: 0, done: 0, failed: 0, stopped: 0 })
const SHOW_TAB = atom({ plugin: 'claudish', key: 'showTab' } as const, { active: null })
const ALLOWANCE = atom({ plugin: 'claudish', key: 'allowance' } as const, { kind: 'probing' })

// One closure set per atom, spelled per atom: a generic helper taking the atom as a parameter is refused.
function bindStore($: EngineInterface): Store {
  return {
    runs: {
      read: () => read($, RUNS),
      update: fn => update($, RUNS, capped(fn)),
      claim: fn => claimVia(f => update($, RUNS, capped(f)), fn),
    },
    feeds: {
      read: () => read($, FEEDS),
      update: fn => update($, FEEDS, capped(fn)),
      claim: fn => claimVia(f => update($, FEEDS, capped(f)), fn),
    },
    stopRequests: {
      read: () => read($, STOP_REQUESTS),
      update: fn => update($, STOP_REQUESTS, capped(fn)),
      claim: fn => claimVia(f => update($, STOP_REQUESTS, capped(f)), fn),
    },
    ledger: {
      read: () => read($, LEDGER),
      update: fn => update($, LEDGER, capped(fn)),
      claim: fn => claimVia(f => update($, LEDGER, capped(f)), fn),
    },
    turn: {
      read: () => read($, TURN),
      update: fn => update($, TURN, capped(fn)),
      claim: fn => claimVia(f => update($, TURN, capped(f)), fn),
    },
    earlier: {
      read: () => read($, EARLIER),
      update: fn => update($, EARLIER, capped(fn)),
      claim: fn => claimVia(f => update($, EARLIER, capped(f)), fn),
    },
    showTab: {
      read: () => read($, SHOW_TAB),
      update: fn => update($, SHOW_TAB, capped(fn)),
      claim: fn => claimVia(f => update($, SHOW_TAB, capped(f)), fn),
    },
    panes: {
      // the family member by computed id: only `id` is computed
      read: id => read($, memberOf(PANES, { requestId: id })),
      update: (id, fn) => update($, memberOf(PANES, { requestId: id }), capped(fn)),
      claim: (id, fn) => claimVia(f => update($, memberOf(PANES, { requestId: id }), capped(f)), fn),
    },
    allowance: {
      read: () => read($, ALLOWANCE),
      update: fn => update($, ALLOWANCE, capped(fn)),
      claim: fn => claimVia(f => update($, ALLOWANCE, capped(f)), fn),
    },
  }
}

// The interface itself may not be kept, so each effect is one closure spelling it out.
function bindHost($: EngineInterface): Host {
  const call: McpCall = (server, tool, args) => $.mcp.call(server, tool, args) // the mod's one MCP closure
  return {
    store: bindStore($),
    source: { ...makeClaudishSource(call), ...makeAllowanceSource(call) }, // run feeds + the allowance report
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs }),
    status: text => $.ui.status(text),
    submit: text => $.prompt.submit({ text }).then(toAccepted, rejected),
    debug: text => $.ui.log(text, { to: 'debug' }),
    panes: () => $.ui.panes(),
    close: id => $.ui.close({ id }),
    messages: () => $.session.messages(),
    sessionId: () => $.session.id(),
  }
}

// A press's pane calls, spelled on the render dispatch that drew the button: the person's press is
// then behind the open, so Claude Code places the pane at any width (host.ts, PressUi).
function bindPressUi($: EngineInterface): PressUi {
  return {
    panes: () => $.ui.panes(),
    open: (id, title, size) => $.ui.open({ id, title, columns: size.columns, rows: size.rows, closeOnEscape: true }),
    close: id => $.ui.close({ id }),
  }
}

/** How long the tmux appearance read may take before it says nothing. */
const TMUX_THEME_TIMEOUT_MS = 1500

/**
 * Inside tmux (TMUX_PANE set), the appearance of the client showing this pane's session: one
 * `tmux list-clients` (TMUX_THEME_FORMAT), read by tmuxClientAppearance. Null outside tmux and on
 * any failure (no tmux, a non-zero exit, the timeout): no opinion. The mod's only host command.
 * Top-level, so the engine's static scan sees its `$` calls.
 */
async function tmuxAppearance($: EngineInterface): Promise<Appearance | null> {
  const pane = await $.env.get('TMUX_PANE')
  if (typeof pane !== 'string' || pane === '') return null
  try {
    const r = await $.process.run(['tmux', 'list-clients', '-t', pane, '-F', TMUX_THEME_FORMAT], { timeoutMs: TMUX_THEME_TIMEOUT_MS })
    return r.exitCode === 0 ? tmuxClientAppearance(r.stdout) : null
  } catch {
    return null
  }
}

/**
 * The badges' palette, by the Magus status line's order (paletteFor): tmux's client appearance,
 * then TERM_THEME, then dark. Null where the reads are refused (keep what is drawn).
 */
async function readTheme($: EngineInterface): Promise<Palette | null> {
  try {
    return paletteFor(await tmuxAppearance($), await $.env.get('TERM_THEME'))
  } catch {
    return null
  }
}

/**
 * Whether this session runs on claudish's Codex pool (isCodexSession). False where the read is
 * refused: the allowance row stays off rather than failing the hook that asked.
 */
async function readCodex($: EngineInterface): Promise<boolean> {
  try {
    return isCodexSession(await $.env.get('CLAUDISH_ACTIVE_MODEL_NAME'))
  } catch {
    return false
  }
}

/** A load's theme read: asked once (session.start and turn ends read it themselves), and the palette it sets. */
type ThemeGate = { asked: boolean; palette: () => Palette; set: (read: Palette) => void }

/**
 * The first hook after a load reads the theme without waiting for it, once, and redraws when it
 * changes the palette: a reload fires no session.start, so this is what keeps a light terminal
 * from being drawn dark until the next turn ends.
 */
function themeOnLoad($: EngineInterface, gate: ThemeGate): void {
  if (gate.asked) return
  gate.asked = true
  void readTheme($).then(read => {
    if (read === null || read === gate.palette()) return
    gate.set(read)
    $.ui.invalidate('ui.render')
  }).catch(() => {}) // a redraw refused keeps what is drawn; the next turn end reads the theme again
}

export const register: Register = (on, options) => {
  // The live cell's look, the plugin's `timeline` option: a change in /config reloads this module with it.
  const look: TimelineLook = options?.timeline === 'line' ? 'line' : 'badges'
  let host: Host | null = null // closures over the session.start dispatch, rebuilt on every load
  // The badges' palette, light or dark (readTheme): read at session start and at every turn end, so
  // a screen that changed mid-session (another tmux client, a switched terminal theme) shows by the
  // next turn.
  let palette: Palette = DARK_PALETTE
  // A reload mid-session (a hot reload, a /config change) runs this module again but fires no
  // session.start, so the palette above would stay dark until a turn ends: the first hook with an
  // interface after a load reads it (themeOnLoad).
  const theme: ThemeGate = { asked: false, palette: () => palette, set: read => (palette = read) }
  // Whether this session runs on claudish's Codex pool (isCodexSession): the allowance row, its poll
  // and the forecast panel exist only then. Null until read: at session.start, or by the first band
  // or panel draw after a reload, which fires no session.start. The environment does not change
  // under a running process, so it is read once per load.
  let codex: boolean | null = null
  let codexAsked = false
  let forecastPutAway = false // off the pool, the forecast panel is closed once per load

  on('session.start', async ($, e, next) => {
    theme.asked = true // read just below, awaited
    codex = await readCodex($)
    host = bindHost($)
    // Claude Code draws the band (and may draw a pane) before this event: those draws met no host,
    // returned before reading any state, and so subscribed to nothing; and nothing else draws the
    // band again (typing changes none of its props). Draw them again now that the host is bound, so
    // they read the atoms and a later write (the first allowance report, a run) redraws them.
    $.ui.invalidate('ui.render')
    palette = (await readTheme($)) ?? palette
    const bound = host
    await wake.resetVolatile(bound) // stop requests and the turn flag: what a reload strands
    void wake.recover(bound).then(() => wake.flushDetached(bound), () => wake.flushDetached(bound)) // inflight → delivered | pending, then deliver what is due
    poll.ensureLoop(bound) // restarts only if state holds something to watch
    if (codex) allowancePoll.start(bound) // the allowance report's own loop; a no-op while one is live
    return next(e)
  })

  // A /clear or a resume ends the conversation, not the process, and no session.start follows it, so
  // the allowance loop keeps polling across it; any other end stops the loop (allowance-poll.ts,
  // onSessionEnd). The run poll resets the old conversation's runs on the same two reasons.
  on('session.end', ($, e, next) => {
    allowancePoll.onSessionEnd(e.reason)
    return host ? poll.onSessionEnd(host, e, next) : next(e)
  })

  // The main loop's turns: notices are held while one runs and delivered at its end. Never a
  // guard: should the hook fail, the turn still runs.
  on('turn.start', ($, e, next) => {
    themeOnLoad($, theme)
    return host ? wake.onTurnStart(host, e, next) : next(e)
  })
    .catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    theme.asked = true
    palette = (await readTheme($)) ?? palette
    return host ? wake.onTurnComplete(host, e, next) : next(e)
  })
    .catch(($, e, next) => next(e))

  // An observer, not a guard: should it fail, the model's call still runs (or keeps the answer it got).
  on('tool.call', { tool: CLAUDISH_TOOL }, ($, e, next) => {
    themeOnLoad($, theme)
    return host ? poll.onClaudishCall(host, e, next) : next(e)
  })
    .catch(($, e, next) => next(e))

  // The band: the allowance row on top, then the runs. Reads use this dispatch's interface, so they
  // subscribe it (an allowance answer or a run change redraws it); presses act through a Store bound
  // to this same dispatch (the reference's own onPress form).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    themeOnLoad($, theme)
    const bound = host
    if (!bound || e.props.hasSurvey) return next(e)
    const runs = await read($, RUNS)
    const feeds = await read($, FEEDS)
    const allowance = await read($, ALLOWANCE)
    const now = await $.clock.now()
    // The Show panel and the forecast panel: open (a pane Claude Code lists as drawn), and the tab
    // the Show panel shows. Read here, so a Hide, a close or a tab press redraws the band.
    const panes = await $.ui.panes()
    const open = panes.some(p => p.id === SHOW_PANE_ID && p.isPlaced)
    const forecastOpen = panes.some(p => p.id === FORECAST_PANE_ID && p.isPlaced)
    const active = activeTab(showTabs(runs, feeds), (await read($, SHOW_TAB)).active)
    const input = {
      runs,
      feeds,
      stops: await read($, STOP_REQUESTS),
      ledger: await read($, LEDGER),
      earlier: await read($, EARLIER),
      bodyColumns: e.props.bodyColumns,
      now,
      panel: { open, active: active?.id ?? null },
    }
    // The allowance row takes one of the band's rows; the runs get the rest. With a single row to
    // give, the runs win: they carry Stop and Show and change by the second, the allowance is ambient.
    if (codex === null && !codexAsked) {
      codexAsked = true // no row until the read lands, rather than a row this session may not own
      void readCodex($).then(read => {
        codex ??= read
        // Either way, draw again: on the pool the row appears; off it, a forecast panel still
        // showing what an earlier load drew is redrawn, and so put away.
        $.ui.invalidate('ui.render')
      }).catch(() => {}) // a refused redraw keeps what is drawn until the next one
    }
    let row = codex === true && allowance.kind === 'ready' ? allowanceRow(allowance.view, now, e.props.bodyColumns, palette.allowance) : null
    const runRows = e.props.maxRows - (row ? 1 : 0)
    let model = runRows >= 1 ? bandModel({ ...input, maxRows: runRows }) : null
    if (row && model === null && runRows < 1) {
      const runsOnly = bandModel({ ...input, maxRows: e.props.maxRows })
      if (runsOnly !== null) {
        model = runsOnly
        row = null
      }
    }
    if (model === null && row === null) return next(e) // nothing to draw
    const press = bindStore($)
    const ui = bindPressUi($)
    // Where the surface draws no Client, the band is handed none, so the row falls back to the stale-meter.
    const resolved = $.ui.resolve(e)
    const els = CLIENT_SURFACES.includes(e.surface) ? resolved : { ...resolved, Client: undefined }
    // Show opens the forecast panel (and asks for a report fresher than 15 s); Hide puts it away.
    const top = row && allowanceRowTree(els, row, forecastOpen, {
      show: () => void controls.pressForecast(ui, bound).catch(err => bound.debug(`claudish allowance Show failed: ${err instanceof Error ? err.message : String(err)}`)),
      hide: () => void controls.pressForecastHide(ui).catch(err => bound.debug(`claudish allowance Hide failed: ${err instanceof Error ? err.message : String(err)}`)),
    })
    const runsTree = model && bandTree(els, model, {
      stop: target => void controls.pressStop(press, bound, target),
      show: target => void controls.pressShow(press, ui, bound, target).then(id => poll.captureOpened(bound, id), () => poll.ensureLoop(bound)),
      hide: () => void controls.pressHide(ui).catch(err => bound.debug(`claudish Hide failed: ${err instanceof Error ? err.message : String(err)}`)),
    }, palette, look)
    if (!top) return runsTree!
    if (!runsTree) return top
    const { Box } = els
    return (<Box flexDirection="column">{top}{runsTree}</Box>) as RenderElement
  })

  // The Show panel: a tab per slot of the runs the band shows, and the active tab's screen (its
  // member, read, so a frame redraws the panel). A tab press makes that tab active; Hide puts it away.
  on('ui.render', { component: 'Pane', requestId: SHOW_PANE_ID }, async ($, e, next) => {
    themeOnLoad($, theme)
    const bound = host
    if (!bound) return next(e)
    const runs = await read($, RUNS)
    const feeds = await read($, FEEDS)
    const tabs = showTabs(runs, feeds)
    const active = activeTab(tabs, (await read($, SHOW_TAB)).active)
    const view = active ? await read($, memberOf(PANES, { requestId: active.id })) : null
    const fit = paneFit(e.props, e.surface)
    const strip = wrapTabs(tabs, active?.id ?? null, fit.columns) // once: the rows drawn are the rows taken off
    const tabRows = { ...fit, rows: Math.max(1, fit.rows - strip.length - 1) } // the strip's rows and its rule (R12.6)
    // The agent line takes a row too, the same for every tab, so the child is that row shorter and a tab switch resizes nothing.
    const agentRows = paneAgentRows(runs, feeds)
    poll.notePanelSize(bound, childSize({ ...tabRows, rows: tabRows.rows - agentRows }), active?.id ?? null) // each tab's child is resized to it before its capture
    const model = view ? paneModel(view, runs, tabRows, await $.clock.now(), feeds) : null
    const press = bindStore($)
    return panelTree($.ui.resolve(e), tabs, strip, active?.id ?? null, model, fit.columns, palette,
      target => void controls.pressTab(press, target).then(id => poll.captureOpened(bound, id), () => poll.ensureLoop(bound)),
      () => void controls.pressHide(bindPressUi($)).catch(err => bound.debug(`claudish Hide failed: ${err instanceof Error ? err.message : String(err)}`)))
  })

  // The forecast panel: the allowance as it stands (read, so a new report redraws it), and Hide.
  on('ui.render', { component: 'Pane', requestId: FORECAST_PANE_ID }, async ($, e, next) => {
    themeOnLoad($, theme)
    const bound = host
    if (!bound) return next(e)
    codex ??= await readCodex($)
    // Off the Codex pool the panel has nothing of this session's to show: put it away (a panel left
    // open from before, or one a reload carried over) and draw nothing. Once per load: the close
    // redraws, and a pane still drawn would otherwise close again on every redraw.
    if (!codex) {
      if (forecastPutAway) return next(e)
      forecastPutAway = true
      void controls.pressForecastHide(bindPressUi($)).catch(err => bound.debug(`claudish allowance panel close failed: ${err instanceof Error ? err.message : String(err)}`))
      return next(e)
    }
    const allowance = await read($, ALLOWANCE)
    const now = await $.clock.now()
    const fit = paneFit(e.props, e.surface)
    const lines = panelLines({ allowance, now, columns: fit.columns, c: palette.allowance })
    return forecastTree($.ui.resolve(e), FORECAST_PANE_TITLE, lines, fit.columns,
      () => void controls.pressForecastHide(bindPressUi($)).catch(err => bound.debug(`claudish allowance Hide failed: ${err instanceof Error ? err.message : String(err)}`)))
  })
}
