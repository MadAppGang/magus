// The composition root of the claudish status mod: every atom and every engine-interface
// call the mod makes is spelled here, because the engine's static scan follows the
// interface into no imported function and reads a state reference only where its plugin
// and key are literals of the file using it. Nothing here decides anything beyond wiring:
// poll, wake and the adapter take values and the closures bound below.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CLAUDISH_TOOL, makeClaudishSource } from './claudish-source'
import { capped, claimVia, rejected, toAccepted, type Host, type PressUi, type Store } from './host'
import { CLIENT_SURFACES, SHOW_PANE_ID } from './domain'
import { activeTab, bandModel, childSize, paneFit, paneModel, showTabs } from './layout'
import * as poll from './poll'
import * as wake from './wake'
import * as controls from './controls'
import { bandTree, type TimelineLook } from './band'
import { DARK_PALETTE, paletteFor, type Palette } from './palette'
import { panelTree } from './pane'

// The eight atoms. plugin and key are literals HERE: the scan reads no reference from another file.
const RUNS = atom({ plugin: 'claudish', key: 'runs' } as const, { epoch: 0, starts: {}, list: [] })
const FEEDS = atom({ plugin: 'claudish', key: 'feeds' } as const, {})
const STOP_REQUESTS = atom({ plugin: 'claudish', key: 'stopRequests' } as const, {})
const PANES = atom({ plugin: 'claudish', key: 'panes' } as const, null) // a family: members by memberOf
const LEDGER = atom({ plugin: 'claudish', key: 'wakeLedger' } as const, { epoch: 0, entries: {} })
const TURN = atom({ plugin: 'claudish', key: 'turn' } as const, { isRunning: false, since: 0 })
const EARLIER = atom({ plugin: 'claudish', key: 'earlier' } as const, { runs: 0, done: 0, failed: 0, stopped: 0 })
const SHOW_TAB = atom({ plugin: 'claudish', key: 'showTab' } as const, { active: null })

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
  }
}

// The interface itself may not be kept, so each effect is one closure spelling it out.
function bindHost($: EngineInterface): Host {
  return {
    store: bindStore($),
    source: makeClaudishSource((server, tool, args) => $.mcp.call(server, tool, args)), // the mod's one MCP closure
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs }),
    status: text => $.ui.status(text),
    submit: text => $.prompt.submit({ text }).then(toAccepted, rejected),
    debug: text => $.ui.log(text, { to: 'debug' }),
    panes: () => $.ui.panes(),
    close: id => $.ui.close({ id }),
    messages: () => $.session.messages(),
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

/** The badges' palette for the person's theme; null where the surface has no settings menu (keep what is drawn). */
async function readTheme($: EngineInterface): Promise<Palette | null> {
  try {
    const theme = (await $.config.list()).find(row => row.key === 'theme')?.value
    return paletteFor(theme, await $.env.get('TERM_THEME'), await $.env.get('COLORFGBG'))
  } catch {
    return null
  }
}

export const register: Register = (on, options) => {
  // The live cell's look, the plugin's `timeline` option: a change in /config reloads this module with it.
  const look: TimelineLook = options?.timeline === 'line' ? 'line' : 'badges'
  let host: Host | null = null // closures over the session.start dispatch, rebuilt on every load
  // The badges' palette, by the person's theme: read at session start and at every turn end, so a
  // theme picked mid-session shows by the next turn. (A config.set hook would be immediate, but an
  // engine that does not know an event refuses the whole module.)
  let palette: Palette = DARK_PALETTE

  on('session.start', async ($, e, next) => {
    host = bindHost($)
    palette = (await readTheme($)) ?? palette
    const bound = host
    await wake.resetVolatile(bound) // stop requests and the turn flag: what a reload strands
    void wake.recover(bound).then(() => wake.flushDetached(bound), () => wake.flushDetached(bound)) // inflight → delivered | pending, then deliver what is due
    poll.ensureLoop(bound) // restarts only if state holds something to watch
    return next(e)
  })

  on('session.end', ($, e, next) => (host ? poll.onSessionEnd(host, e, next) : next(e)))

  // The main loop's turns: notices are held while one runs and delivered at its end. Never a
  // guard: should the hook fail, the turn still runs.
  on('turn.start', ($, e, next) => (host ? wake.onTurnStart(host, e, next) : next(e)))
    .catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    palette = (await readTheme($)) ?? palette
    return host ? wake.onTurnComplete(host, e, next) : next(e)
  })
    .catch(($, e, next) => next(e))

  // An observer, not a guard: should it fail, the model's call still runs (or keeps the answer it got).
  on('tool.call', { tool: CLAUDISH_TOOL }, ($, e, next) => (host ? poll.onClaudishCall(host, e, next) : next(e)))
    .catch(($, e, next) => next(e))

  // The band. Reads use this dispatch's interface, so they subscribe it; presses act through
  // a Store bound to this same dispatch (the reference's own onPress form).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const bound = host
    if (!bound || e.props.hasSurvey) return next(e)
    const runs = await read($, RUNS)
    const feeds = await read($, FEEDS)
    // The Show panel: open (a pane Claude Code lists as drawn), and the tab it shows. Both read
    // here, so a Hide, a close or a tab press redraws the band.
    const open = (await $.ui.panes()).some(p => p.id === SHOW_PANE_ID && p.isPlaced)
    const active = activeTab(showTabs(runs, feeds), (await read($, SHOW_TAB)).active)
    const model = bandModel({
      runs,
      feeds,
      stops: await read($, STOP_REQUESTS),
      ledger: await read($, LEDGER),
      earlier: await read($, EARLIER),
      bodyColumns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
      now: await $.clock.now(),
      panel: { open, active: active?.id ?? null },
    })
    if (model === null) return next(e) // nothing to draw
    const press = bindStore($)
    const ui = bindPressUi($)
    // Where the surface draws no Client, the band is handed none, so the row falls back to the stale-meter.
    const resolved = $.ui.resolve(e)
    const els = CLIENT_SURFACES.includes(e.surface) ? resolved : { ...resolved, Client: undefined }
    return bandTree(els, model, {
      stop: target => void controls.pressStop(press, bound, target),
      show: target => void controls.pressShow(press, ui, bound, target).then(id => poll.captureOpened(bound, id), () => poll.ensureLoop(bound)),
      hide: () => void controls.pressHide(ui),
    }, palette, look)
  })

  // The Show panel: a tab per slot of the runs the band shows, and the active tab's screen (its
  // member, read, so a frame redraws the panel). A tab press makes that tab active.
  on('ui.render', { component: 'Pane', requestId: SHOW_PANE_ID }, async ($, e, next) => {
    const bound = host
    if (!bound) return next(e)
    const runs = await read($, RUNS)
    const tabs = showTabs(runs, await read($, FEEDS))
    const active = activeTab(tabs, (await read($, SHOW_TAB)).active)
    const view = active ? await read($, memberOf(PANES, { requestId: active.id })) : null
    const fit = paneFit(e.props, e.surface)
    const tabRows = { ...fit, rows: Math.max(1, fit.rows - 2) } // the tab strip and its rule
    poll.notePanelSize(bound, childSize(tabRows), active?.id ?? null) // each tab's child is resized to it before its capture
    const model = view ? paneModel(view, runs, tabRows, await $.clock.now()) : null
    const press = bindStore($)
    return panelTree($.ui.resolve(e), tabs, active?.id ?? null, model, fit.columns, palette,
      target => void controls.pressTab(press, target).then(id => poll.captureOpened(bound, id), () => poll.ensureLoop(bound)))
  })
}
