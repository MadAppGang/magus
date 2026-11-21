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
import { CLIENT_SURFACES, FORECAST_PANE_ID, FORECAST_PANE_TITLE, SHOW_PANE_ID, feedKey, isTerminal, viewedElsewhere } from './domain'
import { activeTab, bandModel, childSize, paneAgentRows, paneFit, paneModel, showTabs, wrapTabs } from './layout'
import * as poll from './poll'
import * as scroll from './scroll'
import * as replay from './replay'
import * as transcript from './transcript'
import * as allowancePoll from './allowance-poll'
import * as wake from './wake'
import * as controls from './controls'
import { bandTree, type TimelineLook } from './band'
import { allowanceRow } from './allowance-row'
import { allowanceRowTree, forecastTree } from './allowance'
import { panelLines } from './forecast'
import { DARK_PALETTE, TMUX_THEME_FORMAT, paletteFor, themeNameAppearance, tmuxClientAppearance, type Appearance, type Palette } from './palette'
import { panelTree, type ModeSwitch } from './pane'

// The atoms. plugin and key are literals HERE: the scan reads no reference from another file.
const RUNS = atom({ plugin: 'claudish', key: 'runs' } as const, { epoch: 0, starts: {}, list: [] })
const FEEDS = atom({ plugin: 'claudish', key: 'feeds' } as const, {})
const STOP_REQUESTS = atom({ plugin: 'claudish', key: 'stopRequests' } as const, {})
const PANES = atom({ plugin: 'claudish', key: 'panes' } as const, null) // a family: members by memberOf
const LEDGER = atom({ plugin: 'claudish', key: 'wakeLedger' } as const, { epoch: 0, entries: {} })
const TURN = atom({ plugin: 'claudish', key: 'turn' } as const, { isRunning: false, since: 0 })
const EARLIER = atom({ plugin: 'claudish', key: 'earlier' } as const, { runs: 0, done: 0, failed: 0, stopped: 0 })
const SHOW_TAB = atom({ plugin: 'claudish', key: 'showTab' } as const, { active: null })
const ALLOWANCE = atom({ plugin: 'claudish', key: 'allowance' } as const, { kind: 'probing' })
const TEXT_VIEW = atom({ plugin: 'claudish', key: 'textView' } as const, { rev: 0, modes: {} })
const REPLAYS = atom({ plugin: 'claudish', key: 'replays' } as const, {})
const THEME_NOTE = atom({ plugin: 'claudish', key: 'themeNoteShown' } as const, false) // herdrThemeNote: said once per session

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
    replays: {
      read: () => read($, REPLAYS),
      update: fn => update($, REPLAYS, capped(fn)),
      claim: fn => claimVia(f => update($, REPLAYS, capped(f)), fn),
    },
    textView: {
      read: () => read($, TEXT_VIEW),
      update: fn => update($, TEXT_VIEW, capped(fn)),
      claim: fn => claimVia(f => update($, TEXT_VIEW, capped(f)), fn),
    },
  }
}

// The interface itself may not be kept, so each effect is one closure spelling it out.
function bindHost($: EngineInterface): Host {
  const call: McpCall = (server, tool, args) => $.mcp.call(server, tool, args) // the mod's one MCP closure
  return {
    store: bindStore($),
    // run feeds + the allowance report; a run's record is read from where the run lives
    source: { ...makeClaudishSource(call, path => $.fs.read(path)), ...makeAllowanceSource(call) },
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
    scrollEnd: id => $.ui.scroll({ in: id, to: 'end' }).then(() => undefined, () => undefined),
    record: line => recordFeedLine($, line),
  }
}

/** The feed record keeps at most this many lines: the newest. */
const FEED_RECORD_LINES = 500
/** Each line of the feed record is cut to this many characters. */
const FEED_RECORD_LINE_MAX = 2_000

/** Claude Code's config folder: CLAUDE_CONFIG_DIR, else ~/.claude; null when neither is known. */
async function claudeConfigDir($: EngineInterface): Promise<string | null> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  return typeof configDir === 'string' && configDir !== '' ? configDir : typeof home === 'string' && home !== '' ? `${home}/.claude` : null
}

/**
 * Appends one line to `<config dir>/claudish-status-feed.log`, keeping the newest
 * FEED_RECORD_LINES, each cut to FEED_RECORD_LINE_MAX characters. A missing file reads as
 * empty; any failure is ignored, so a tick never fails on its record. It is a read-modify-write
 * of a file every session shares, so two sessions failing in the same instant can lose a line,
 * which a diagnostic record accepts.
 */
async function recordFeedLine($: EngineInterface, line: string): Promise<void> {
  try {
    const dir = await claudeConfigDir($)
    if (dir === null) return
    const path = `${dir}/claudish-status-feed.log`
    const was = await $.fs.read(path).then(t => (typeof t === 'string' ? t : ''), () => '')
    const lines = [...was.split('\n').filter(l => l !== ''), line.slice(0, FEED_RECORD_LINE_MAX)].slice(-FEED_RECORD_LINES)
    await $.fs.write(path, `${lines.join('\n')}\n`)
  } catch {
    // the record is a diagnostic: losing a line never stops the poll
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
 * Claude Code's own theme, the background the band is drawn on: the session's `theme` row in
 * /config, and for `custom:<name>` the `base` in `<config dir>/themes/<name>.json` (the config dir
 * is CLAUDE_CONFIG_DIR, else ~/.claude). Null for `auto`, a missing or unreadable file, or a
 * refused read: no opinion, and the steps after it answer.
 */
async function claudeAppearance($: EngineInterface): Promise<Appearance | null> {
  try {
    const name = (await $.config.list()).find(row => row.key === 'theme')?.value
    if (typeof name !== 'string' || !name.startsWith('custom:')) return themeNameAppearance(name)
    const dir = await claudeConfigDir($)
    if (dir === null) return null
    const text = await $.fs.read(`${dir}/themes/${name.slice('custom:'.length)}.json`)
    return themeNameAppearance(typeof text === 'string' ? (JSON.parse(text) as { base?: unknown })?.base : undefined)
  } catch {
    return null
  }
}

/** The step that answered a theme read: Claude Code's theme, the tmux client, TERM_THEME, or the dark default. */
type ThemeSource = 'claude' | 'tmux' | 'env' | 'default'

/** A theme read: the palette, and which step decided it. */
type ThemeRead = { palette: Palette; source: ThemeSource }

/**
 * The badges' palette, by the Magus status line's order (paletteFor): Claude Code's own theme,
 * then tmux's client appearance, then TERM_THEME, then dark, with the step that answered. tmux is
 * asked only when Claude Code's theme says nothing. Null where the reads are refused (keep what
 * is drawn).
 */
async function readTheme($: EngineInterface): Promise<ThemeRead | null> {
  try {
    const claude = await claudeAppearance($)
    if (claude !== null) return { palette: paletteFor(claude, null), source: 'claude' }
    const tmux = await tmuxAppearance($)
    if (tmux !== null) return { palette: paletteFor(null, tmux), source: 'tmux' }
    const termTheme = await $.env.get('TERM_THEME')
    const source: ThemeSource = termTheme === 'light' || termTheme === 'dark' ? 'env' : 'default'
    return { palette: paletteFor(null, null, termTheme), source }
  } catch {
    return null
  }
}

/** The one line said when herdr leaves the band no terminal theme to follow. */
const HERDR_THEME_NOTE = 'Run-status colours: herdr reports no terminal theme, so TERM_THEME decides (else dark).'

/**
 * Under herdr nothing reports the terminal's theme, so TERM_THEME or the dark default decides the
 * palette. Says so once per session, as a toast, from a claudish call: only sessions that use
 * claudish see it, and the band's render never writes or toasts. Fires only when the last theme
 * read was answered by TERM_THEME or the default (a theme not read yet says nothing; the next
 * call checks again) and HERDR_PANE_ID is set. The atom is never reset within the session.
 * Any refused read or write says nothing: the call goes on either way.
 */
async function herdrThemeNote($: EngineInterface, gate: ThemeGate): Promise<void> {
  try {
    const source = gate.source()
    if (source !== 'env' && source !== 'default') return
    const pane = await $.env.get('HERDR_PANE_ID')
    if (typeof pane !== 'string' || pane === '') return
    let first = false // assigned on every pass, so the pass whose write landed decides
    await update($, THEME_NOTE, capped(shown => {
      first = shown !== true
      return true
    }))
    if (first) await $.ui.toast(HERDR_THEME_NOTE)
  } catch {
    // said nothing; the next claudish call checks again
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

/**
 * A load's theme read: asked once (session.start and turn ends read it themselves), the palette it
 * sets, and the step that answered the last read (null until one is read).
 */
type ThemeGate = { asked: boolean; palette: () => Palette; source: () => ThemeSource | null; set: (read: ThemeRead) => void }

/**
 * The first hook after a load reads the theme without waiting for it, once, and redraws when it
 * changes the palette: a reload fires no session.start, so this is what keeps a light terminal
 * from being drawn dark until the next turn ends.
 */
function themeOnLoad($: EngineInterface, gate: ThemeGate): void {
  if (gate.asked) return
  gate.asked = true
  void repaintTheme($, gate)
}

/**
 * Reads the theme and redraws when it changes the palette: the band redraws only on what it reads,
 * and a theme change is none of that. A read or redraw refused keeps what is drawn.
 */
async function repaintTheme($: EngineInterface, gate: ThemeGate): Promise<void> {
  try {
    const read = await readTheme($)
    if (read === null) return
    const changed = read.palette !== gate.palette()
    gate.set(read) // the source is kept even when the palette is the same
    if (!changed) return
    $.ui.invalidate('ui.render')
  } catch {
    // the next turn end reads the theme again
  }
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
  let themeSource: ThemeSource | null = null // the step that answered the last theme read (herdrThemeNote)
  const theme: ThemeGate = {
    asked: false,
    palette: () => palette,
    source: () => themeSource,
    set: read => {
      palette = read.palette
      themeSource = read.source
    },
  }
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
    const read = await readTheme($)
    if (read !== null) theme.set(read)
    const bound = host
    await wake.resetVolatile(bound) // stop requests and the turn flag: what a reload strands
    void wake.recover(bound).then(() => wake.flushDetached(bound), () => wake.flushDetached(bound)) // inflight → delivered | pending, then deliver what is due
    poll.ensureLoop(bound) // restarts only if state holds something to watch
    void replay.adopt(bound).catch(err => bound.debug(`claudish Show replay adopt failed: ${err instanceof Error ? err.message : String(err)}`)) // what a reload left open: the watcher closes it if the panel is gone
    if (codex) allowancePoll.start(bound) // the allowance report's own loop; a no-op while one is live
    return next(e)
  })

  // A /clear or a resume ends the conversation, not the process, and no session.start follows it, so
  // the allowance loop keeps polling across it; any other end stops the loop (allowance-poll.ts,
  // onSessionEnd). The run poll resets the old conversation's runs on the same two reasons.
  on('session.end', ($, e, next) => {
    allowancePoll.onSessionEnd(e.reason)
    if (host && (e.reason === 'clear' || e.reason === 'resume')) void replay.closeAll(host).catch(() => undefined)
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
    await repaintTheme($, theme)
    return host ? wake.onTurnComplete(host, e, next) : next(e)
  })
    .catch(($, e, next) => next(e))

  // A theme picked in /theme repaints at once rather than at the next turn end: read again once the
  // setting is written. An observer: should it fail, the change still goes through.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const set = await next(e)
    theme.asked = true
    await repaintTheme($, theme)
    return set
  })
    .catch(($, e, next) => next(e))

  // An observer, not a guard: should it fail, the model's call still runs (or keeps the answer it got).
  // The band becomes active here, so this is where the herdr theme note is said, once per session.
  on('tool.call', { tool: CLAUDISH_TOOL }, async ($, e, next) => {
    themeOnLoad($, theme)
    await herdrThemeNote($, theme)
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
      show: target => void controls.pressShow(press, ui, bound, target).then(id => (void scroll.release(bound, id), poll.expandOpened(bound, id)), () => poll.ensureLoop(bound)),
      hide: () => void controls.pressHide(ui).then(() => scroll.release(bound, null)).catch(err => bound.debug(`claudish Hide failed: ${err instanceof Error ? err.message : String(err)}`)),
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
    let model = view ? paneModel(view, runs, tabRows, await $.clock.now(), feeds) : null
    // The Screen / Text switch: where claudish can give the tab's transcript. Text draws it as lines
    // the engine scrolls; a tab not read yet is read now (the read redraws through textView.rev).
    const textView = await read($, TEXT_VIEW)
    transcript.prune(new Set(tabs.map(t => t.id)))
    let toggle: ModeSwitch | null = null
    // Held by another viewer, the tab draws only its band: no mode, no transcript read, no replay.
    const collapsed = viewedElsewhere(view)
    if (active && view && model && !collapsed) {
      const run = runs.list.find(r => r.id === view.runId)
      const slot = run?.slots.find(x => x.slot === view.slot)
      const support = run ? feeds[feedKey(run.ref)] : undefined
      const canText = support?.kind === 'speaks' && support.can.transcript === true
      const ended = view.status === 'ended' || (slot !== undefined && isTerminal(slot.state)) || (run?.settledAt ?? null) !== null
      const canReplay = support?.kind === 'speaks' && support.can.replay === true
      const mode = transcript.modeOf(textView, active.id, ended, canText, canReplay && !replay.replayFailed(active.id))
      // A finished tab the visible panel draws on its screen: its real interface, opened only now.
      // The slot's own state, not the view's: a pane that never spawned reads ended while its session runs.
      const finished = (slot !== undefined && isTerminal(slot.state)) || (run?.settledAt ?? null) !== null
      if (finished && canReplay && mode === 'screen' && run && support?.kind === 'speaks') replay.ensureReplay(bound, active.id, run.ref, view.slot, support.can.spans, support.can.viewer === true)
      if (canText) {
        const id = active.id
        toggle = { mode, press: m => void (m === 'text' ? scroll.release(bound, null) : Promise.resolve()).then(() => transcript.setMode(bound, id, m)).catch(err => bound.debug(`claudish Show mode failed: ${err instanceof Error ? err.message : String(err)}`)) }
      }
      if (mode === 'screen' && view.frame === null && replay.replayOpening(active.id)) model = { ...model, body: { kind: 'note', note: replay.REPLAY_OPENING_NOTE } }
      if (mode === 'text') {
        transcript.keepReading(bound, active.id)
        const text = transcript.textOf(active.id)
        model = { ...model, body: { kind: 'text', lines: text?.lines ?? [], dropped: text?.dropped ?? 0, note: text?.note ?? null, final: text?.final ?? false } }
      }
    }
    const press = bindStore($)
    return panelTree($.ui.resolve(e), tabs, strip, active?.id ?? null, model, fit.columns, palette,
      target => void controls.pressTab(press, target).then(id => (void scroll.release(bound, id), poll.expandOpened(bound, id)), () => poll.ensureLoop(bound)),
      () => void controls.pressHide(bindPressUi($)).then(() => replay.closeAll(bound)).then(() => scroll.release(bound, null)).catch(err => bound.debug(`claudish Hide failed: ${err instanceof Error ? err.message : String(err)}`)),
      toggle,
      active && collapsed ? () => void poll.takeView(bound, active.id).catch(err => bound.debug(`claudish Show take view failed: ${err instanceof Error ? err.message : String(err)}`)) : null)
  })

  // The person's wheel or scroll keys over the Show panel scroll the shown child's own transcript:
  // claudish keeps no history to draw here, only the child does. The panel's window stays put (the
  // next capture shows the move); where the tab cannot scroll, the engine scrolls the panel as before.
  on('ui.scroll', { requestId: SHOW_PANE_ID }, async ($, e, next) => {
    const bound = host
    if (!bound || e.origin.kind !== 'person') return next(e)
    // A tab drawn as text is the engine's to scroll: its tree is taller than the pane.
    if ((await transcript.shownTextTab(bound)) !== null) return next(e)
    return (await scroll.forward(bound, e.by)) ? {} : next(e)
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
