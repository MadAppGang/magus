// The composition root of the claudish status mod: every atom and every engine-interface
// call the mod makes is spelled here, because the engine's static scan follows the
// interface into no imported function and reads a state reference only where its plugin
// and key are literals of the file using it. Nothing here decides anything beyond wiring:
// poll, wake and the adapter take values and the closures bound below.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CLAUDISH_TOOL, makeClaudishSource } from './claudish-source'
import { capped, claimVia, rejected, toAccepted, type Host, type Store } from './host'
import { PANE_ID_PATTERN } from './domain'
import { bandModel, paneFit, paneModel } from './layout'
import * as poll from './poll'
import * as wake from './wake'
import * as controls from './controls'
import { bandTree } from './band'
import { paneTree } from './pane'

// The seven atoms. plugin and key are literals HERE: the scan reads no reference from another file.
const RUNS = atom({ plugin: 'claudish', key: 'runs' } as const, { epoch: 0, starts: {}, list: [] })
const FEEDS = atom({ plugin: 'claudish', key: 'feeds' } as const, {})
const STOP_REQUESTS = atom({ plugin: 'claudish', key: 'stopRequests' } as const, {})
const PANES = atom({ plugin: 'claudish', key: 'panes' } as const, null) // a family: members by memberOf
const LEDGER = atom({ plugin: 'claudish', key: 'wakeLedger' } as const, { epoch: 0, entries: {} })
const TURN = atom({ plugin: 'claudish', key: 'turn' } as const, { isRunning: false, since: 0 })
const EARLIER = atom({ plugin: 'claudish', key: 'earlier' } as const, { runs: 0, done: 0, failed: 0, stopped: 0 })

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
    panes: {
      // the family member by computed id: only `id` is computed
      read: id => read($, memberOf(PANES, { requestId: id })),
      update: (id, fn) => update($, memberOf(PANES, { requestId: id }), capped(fn)),
      claim: (id, fn) => claimVia(f => update($, memberOf(PANES, { requestId: id }), capped(f)), fn),
    },
  }
}

// The interface itself may not be kept, so each effect is one closure spelling it out.
function bindHost($: EngineInterface, cwd: string): Host {
  return {
    store: bindStore($),
    cwd,
    source: makeClaudishSource((server, tool, args) => $.mcp.call(server, tool, args)), // the mod's one MCP closure
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs }),
    status: text => $.ui.status(text),
    submit: text => $.prompt.submit({ text }).then(toAccepted, rejected),
    debug: text => $.ui.log(text, { to: 'debug' }),
    panes: () => $.ui.panes(),
    open: (id, title, columns) => $.ui.open(columns === undefined ? { id, title } : { id, title, columns }),
    close: id => $.ui.close({ id }),
    messages: () => $.session.messages(),
  }
}

export const register: Register = on => {
  let host: Host | null = null // closures over the session.start dispatch, rebuilt on every load

  on('session.start', async ($, e, next) => {
    host = bindHost($, e.cwd)
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
  on('turn.complete', ($, e, next) => (host ? wake.onTurnComplete(host, e, next) : next(e)))
    .catch(($, e, next) => next(e))

  // Observe-only: every row passes on unchanged, and nothing waits on the look. A row carrying
  // claudish's own monitor lines stands the wake down for the changes they report.
  on('session.append', ($, e, next) => {
    if (host) wake.observeRow(host, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // An observer, not a guard: should it fail, the model's call still runs (or keeps the answer it got).
  on('tool.call', { tool: CLAUDISH_TOOL }, ($, e, next) => (host ? poll.onClaudishCall(host, e, next) : next(e)))
    .catch(($, e, next) => next(e))

  // The band. Reads use this dispatch's interface, so they subscribe it; presses act through
  // a Store bound to this same dispatch (the reference's own onPress form).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const bound = host
    if (!bound || e.props.hasSurvey) return next(e)
    const model = bandModel({
      runs: await read($, RUNS),
      feeds: await read($, FEEDS),
      stops: await read($, STOP_REQUESTS),
      ledger: await read($, LEDGER),
      earlier: await read($, EARLIER),
      bodyColumns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
    })
    if (model === null) return next(e) // nothing to draw
    const press = bindStore($)
    return bandTree($.ui.resolve(e), model, {
      stop: target => void controls.pressStop(press, bound, target),
      show: target => void controls.pressShow(press, bound, target).then(() => poll.ensureLoop(bound)),
    })
  })

  // A Show tab: its own member (a frame redraws that tab alone) and the runs for its header.
  on('ui.render', { component: 'Pane', requestId: PANE_ID_PATTERN }, async ($, e, next) => {
    const view = await read($, memberOf(PANES, e))
    if (!view) return next(e)
    return paneTree($.ui.resolve(e), paneModel(view, await read($, RUNS), paneFit(e.props, e.surface)))
  })

  // A closed tab forgets its view; it never refuses the close, failing or not.
  on('ui.close', { id: PANE_ID_PATTERN }, async ($, e, next) => {
    await update($, memberOf(PANES, { requestId: e.id }), () => null)
    return next(e)
  }).catch(($, e, next) => next(e))
}
