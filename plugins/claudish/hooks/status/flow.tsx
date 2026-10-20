// The live cell: what a slot does, drawn as a timeline. A surface module (a `Client`), so it moves
// on the surface's own frame clock and the band never redraws for an animation frame. Two looks,
// picked in /config (the plugin's `timeline` option):
//
//   badges  each finished block a coloured badge with its time (`:05`, `3×:03` for a run of one
//           colour, `+11 34:43` for the oldest folded away); the current job at the right as a
//           two-part badge, its name then its live time, and its words. A finished job scrolls
//           out to the right and the next scrolls in.
//           An ended row drops the badges: its end badge, then the model's last words or the error.
//   line    a running line: every step as a badge and its words, typed in from the right, each
//           ended step with its time; pac-man at the left eats the line. Silent, the line stops
//           and a ghost closes in from the right, reaching him at the last stale step.
//
// A cell narrower than NARROW draws neither: one bar per step, the current job's badge at the right
// (only the bars, the current one blinking, when even that does not fit).
//
// The time between polls counts on from the last poll's values, frame by frame. Self-contained: it
// runs on the drawing thread, so it imports nothing at run time.

import type { ClientModule } from 'claude-code'
import type { ClaudishTrailKind } from '../../types'
import type { TimelineColors } from './palette'

/** One step as the band hands it: ms from the run's start, its kind, the tool, its one line. */
export type FlowStep = { t: number; k: ClaudishTrailKind; tool: string; x: string }

/** What the band hands the cell (plain data): see layout.ts TrailView. */
export type FlowProps = {
  look: 'badges' | 'line'
  /** the last steps; `before` counts the steps that came before them, and their time together */
  steps: FlowStep[]
  before: { count: number; ms: number }
  /** ms since the run started, at the band's render */
  elapsed: number
  live: boolean
  /** the silence at the last poll, in whole seconds */
  idle: number
  /** ms since the slot ended, at the band's render; 0 while live */
  endedFor: number
  /** silence from which the slot reads as stale, and from which it reads as gone, in seconds */
  staleAfter: number
  staleFull: number
  /** the cell's width before the surface has laid it out */
  width: number
  c: TimelineColors
}

/**
 * ms: how long the instance has counted; mount: the run's clock (ms since it started) when it
 * began, so the cell counts time itself and a poll costs no redraw of its own. Two clocks count:
 * a slow one, once a second, always; a fast one, every FRAME_MS, only while the drawing moves
 * (fast, until busyTo). halt: the row has ended and its last animation is done, so both stop.
 */
type FlowState = { ms: number; mount: number; busyTo: number; fast: boolean; halt: boolean }
const SLOW_MS = 1000
/** The cell's own count may run this far from the band's before it takes the band's again. */
const DRIFT_MS = 1500

/** The fast clock's period, while something moves. */
const FRAME_MS = 100
/** An ended row animates this long (the failure's last frames), then stands still. */
const SETTLE_MS = 2000
/** How fast the running line types a step in, in characters a second. */
const CPS = 40
/** How fast a finished job scrolls out, and the next one in, in cells a second. */
const OUT_CPS = 150
const IN_CPS = 120
/** The badges keep this share of the row, so a long job never pushes them around. */
const BADGE_SHARE = 0.5
/** Below this many columns, the narrow look. */
const NARROW = 30

type Seg = { text: string; fg: string; bg?: string; bold?: boolean; italic?: boolean }
type Step = FlowStep

// ── shared ────────────────────────────────────────────────────────────────────

function mix(a: string, b: string, t: number): string {
  const x = [1, 3, 5].map(i => Number.parseInt(a.slice(i, i + 2), 16))
  const y = [1, 3, 5].map(i => Number.parseInt(b.slice(i, i + 2), 16))
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}

const cells = (segs: readonly Seg[]): Seg[] => segs.flatMap(s => Array.from(s.text, ch => ({ ...s, text: ch })))

type Family = 'read' | 'edit' | 'run' | 'web' | 'agent' | 'other'
function familyOf(tool: string): Family {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'edit'
  if (tool === 'Bash' || tool === 'BashOutput') return 'run'
  if (/^Web/.test(tool)) return 'web'
  if (/^(Task|Agent)$/.test(tool) || tool.startsWith('mcp__')) return 'agent'
  return 'other'
}
const shortName = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__').pop() || tool : tool)

/** A step's badge colour and name: a start or a stretch with no known activity is grey. */
function badgeOf(m: Step, c: TimelineColors): { name: string; color: string } {
  switch (m.k) {
    case 'start': return { name: 'starting', color: c.dim }
    case 'tool': return { name: shortName(m.tool) || 'tool', color: c[familyOf(m.tool)] }
    case 'think': return { name: 'think', color: c.think }
    case 'say': return { name: 'says', color: c.say }
    case 'wait': return { name: 'asks', color: c.ask }
    case 'finish': return { name: 'wrap-up', color: c.finish }
    case 'background': return { name: 'background', color: c.other }
    case 'done': return { name: 'done', color: c.done }
    case 'stop': return { name: 'stopped', color: c.dim }
    case 'fail': return { name: m.x.split(': ')[0] || 'failed', color: c.fail }
    default: return { name: 'working', color: c.dim }
  }
}

/** A finished block's fill, faded toward the page so the current job stands out; its text in the block's own hue. */
export function soft(color: string, c: TimelineColors): { fg: string; bg: string } {
  return { fg: mix(color, c.words, 0.3), bg: mix(color, c.page, 0.78) }
}

/** The names and colours the finished blocks of these rows use, in the order a run meets them: the band's legend. */
export function legendOf(rows: readonly (readonly FlowStep[])[], c: TimelineColors): { name: string; color: string }[] {
  const seen = new Map<string, string>()
  for (const steps of rows) {
    for (const m of steps.slice(0, -1)) {
      const color = badgeOf(m, c).color
      if (color === c.dim || isEnd(m.k)) continue
      const name = m.k === 'tool' ? familyOf(m.tool) : badgeOf(m, c).name
      if (![...seen.values()].includes(color)) seen.set(name, color)
    }
  }
  return [...seen].map(([name, color]) => ({ name, color }))
}

/** A step's words after its badge: a failure's message without its code; the words in their kind's colour. */
function wordsOf(m: Step, c: TimelineColors): Seg[] {
  if (m.x === '') return []
  if (m.k === 'fail') {
    const rest = m.x.split(': ').slice(1).join(': ')
    return rest ? [{ text: ` ${rest}`, fg: c.fail }] : []
  }
  if (m.k === 'tool') return [{ text: ` ${m.x}`, fg: c[familyOf(m.tool)] }]
  if (m.k === 'wait') return [{ text: ` ${m.x}`, fg: c.ask }]
  if (m.k === 'done') return [{ text: ` ${m.x}`, fg: c.done }]
  return [{ text: ` ${m.x}`, fg: c.words, italic: true }]
}

const isEnd = (k: ClaudishTrailKind) => k === 'done' || k === 'fail' || k === 'stop'

/** A step's time, the running line's way: tenths under 10 s, seconds under a minute, then 1m05s. */
function took(ms: number): string {
  const s = Math.max(0, ms) / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.floor(s)}s`
  return `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

/** A block's time, the badges' way: :05 under a minute, then 1:22. */
function clockOf(ms: number): string {
  const t = Math.floor(Math.max(0, ms) / 1000)
  return `${t >= 60 ? Math.floor(t / 60) : ''}:${String(t % 60).padStart(2, '0')}`
}

type Frame = { steps: Step[]; before: { count: number; ms: number }; now: number; live: boolean; idle: number; endedFor: number; ms: number; width: number; staleAfter: number; staleFull: number; c: TimelineColors }
/** A look's drawing, and for how many more ms something in it moves (0: only its clocks change). */
type Drawn = { segs: Seg[]; busy: number }
/** On every other second: a blink that a calm row, redrawn once a second, still shows. */
const blink = (f: Frame) => Math.floor(f.ms / 1000) % 2 === 0

const silenceColor = (f: Frame) => (f.idle >= f.staleFull * 0.75 ? f.c.bad : f.idle >= f.staleFull / 4 ? f.c.warn : f.c.ok)
const waitingOf = (f: Frame) => f.live && f.steps[f.steps.length - 1]?.k === 'wait'
/** Silent long enough to read as stale; waiting on the person is not silence. */
const staleOf = (f: Frame) => f.live && !waitingOf(f) && f.idle >= f.staleAfter

// ── line: a running line pac-man eats ─────────────────────────────────────────

function lineLook(f: Frame): Drawn {
  const { c } = f
  const waiting = waitingOf(f)
  const stale = staleOf(f)
  const steps = f.steps
  const line: Seg[] = []
  let typing = false
  let typingFor = 0
  let liveMs: number | null = null
  steps.forEach((m, i) => {
    const b = badgeOf(m, c)
    const head = cells([{ text: ` ${b.name} `, fg: c.ink, bg: b.color, bold: true }])
    const all = [...head, ...cells(wordsOf(m, c))]
    if (all.length === 0) return
    // Typed in while the row is live; an ended row stands still, so its last words show whole.
    const shown = f.live ? Math.min(all.length, head.length + Math.floor(((f.now - m.t) / 1000) * CPS)) : all.length
    if (shown < all.length) {
      typing = true
      typingFor = Math.max(typingFor, ((all.length - shown) / CPS) * 1000)
    }
    if (line.length > 0 && shown > 0) line.push(...cells([{ text: '  ', fg: c.dim }]))
    line.push(...all.slice(0, shown))
    const next = steps[i + 1]
    if (shown < all.length || isEnd(m.k)) return
    // Its time once its words are in: final when the next step began, counting at the right while it is the live one.
    if (next) line.push(...cells([{ text: ` ${took(next.t - m.t)}`, fg: mix(c.words, c.page, 0.35) }]))
    else if (f.live) liveMs = f.now - m.t
  })
  const clock: Seg[] = liveMs === null ? [] : [{ text: ` ${took(liveMs)}`, fg: stale ? silenceColor(f) : waiting ? c.ask : c.words, bold: true }]
  // Pac-man and its space, then the line, then the clock: at least 7 cells kept for it, more once it grows.
  const room = Math.max(4, f.width - 2 - Math.max(7, clock[0]?.text.length ?? 0))
  const body = line.slice(Math.max(0, line.length - room))
  // While the line is shorter than the room, pellets wait between pac-man and the words.
  const row: Seg[] = [...Array.from({ length: room - body.length }, (_, i) => ({ text: (i + line.length) % 3 === 0 ? '·' : ' ', fg: mix(c.dim, c.page, 0.2) })), ...body]
  if (stale) {
    // The ghost enters right after the words and closes in on pac-man; what it passed fades.
    const reach = Math.min(1, (f.idle - f.staleAfter) / Math.max(1, f.staleFull - f.staleAfter))
    const at = Math.min(row.length - 1, Math.round((1 - reach) * row.length))
    for (let i = at; i < row.length; i++) row[i] = { ...row[i]!, fg: mix(row[i]!.bg ?? row[i]!.fg, c.page, 0.6), bg: undefined, bold: false }
    row.splice(at, 1, { text: 'ᗣ', fg: blink(f) ? c.ghost : c.ghost2, bold: true })
  }
  let head: Seg
  if (f.live) {
    const chew = typing && !stale && Math.floor(f.ms / FRAME_MS) % 4 < 2
    head = { text: chew ? '●' : 'ᗧ', fg: f.idle >= f.staleFull && stale ? c.bad : waiting ? (blink(f) ? c.ask : c.pac) : stale ? c.pacQuiet : c.pac, bold: true }
  } else {
    const end = f.steps[f.steps.length - 1]?.k
    const death = ['ᗧ', '◔', '◑', '◕', '●', '✕']
    head = end === 'fail' ? { text: death[Math.min(death.length - 1, Math.floor(f.endedFor / 250))]!, fg: c.fail, bold: true }
      : end === 'stop' ? { text: '■', fg: c.dim, bold: true }
      : { text: '✓', fg: c.done, bold: true }
  }
  const dying = !f.live && f.steps[f.steps.length - 1]?.k === 'fail' ? Math.max(0, 1500 - f.endedFor) : 0
  return { segs: [head, { text: ' ', fg: c.dim }, ...row, ...clock], busy: Math.max(typingFor, dying) }
}

// ── badges: the past as timed badges, the current job at the right ────────────

/** A job: its words, then its two-part badge, so the badge sits flush right. Too long for `max`,
 *  the words are cut and the badge is kept whole. */
function jobCells(f: Frame, steps: readonly Step[], i: number, silent: boolean, max = Infinity): Seg[] {
  const badge = jobBadge(f, steps, i, silent)
  let words = cells(wordsOf(steps[i]!, f.c))
  if (words.length > 0) words = [...words, { text: ' ', fg: f.c.dim }]
  const room = max - badge.length
  if (words.length > room) words = room <= 2 ? [] : [...words.slice(0, room - 2), { text: '…', fg: f.c.dim }, { text: ' ', fg: f.c.dim }]
  return [...words, ...badge]
}

/** A job's two-part badge alone: its name, then its time. */
function jobBadge(f: Frame, steps: readonly Step[], i: number, silent: boolean): Seg[] {
  const { c } = f
  const m = steps[i]!
  const b = badgeOf(m, c)
  const out: Seg[] = [{ text: ` ${b.name} `, fg: c.ink, bg: b.color, bold: true }]
  if (!isEnd(m.k)) {
    const next = steps[i + 1]
    const ms = (next?.t ?? f.now) - m.t
    const alarm = !next && silent
    out.push({ text: ` ${clockOf(ms)} `, fg: alarm ? c.silenceInk : c.timeInk, bg: alarm ? silenceColor(f) : mix(b.color, '#FFFFFF', 0.45), bold: true })
  }
  return cells(out)
}

/** An ended row: the error, or the model's last words, then its end badge flush right. No past badges. */
function endedLook(f: Frame): Drawn {
  const { c } = f
  const W = f.width
  const steps = f.steps
  const row: Seg[] = Array.from({ length: W }, () => ({ text: ' ', fg: c.dim }))
  const end = steps[steps.length - 1]
  if (!end) return { segs: row, busy: 0 }
  const badge = jobBadge(f, steps, steps.length - 1, false).slice(-W)
  const said = end.k === 'fail' ? null : [...steps].reverse().find(m => m.k === 'say' && m.x !== '')
  const words = end.k === 'fail' ? wordsOf(end, c).map(s => ({ ...s, text: s.text.trimStart() }))
    : said ? [{ text: said.x, fg: c.words }] : []
  let text = cells(words)
  const room = W - badge.length - 1
  if (text.length > room) text = room <= 0 ? [] : [...text.slice(0, room - 1), { text: '…', fg: c.dim }]
  text.forEach((s, x) => { row[x] = s })
  badge.forEach((s, j) => { row[W - badge.length + j] = s })
  return { segs: row, busy: 0 }
}

/** A narrow cell: one bar per step, the current job's badge at the right; too narrow for it, the bars alone, the current one blinking. */
function narrowLook(f: Frame): Drawn {
  const { c } = f
  const W = f.width
  const steps = f.steps
  const n = steps.length
  const row: Seg[] = Array.from({ length: W }, () => ({ text: ' ', fg: c.dim }))
  if (n === 0) return { segs: row, busy: 0 }
  const bar = (m: Step): Seg => ({ text: '▌', fg: badgeOf(m, c).color })
  const badge = jobBadge(f, steps, n - 1, staleOf(f))
  let shown: Seg[]
  if (badge.length + 1 <= W) {
    const bars = steps.slice(0, -1).map(bar)
    const room = W - badge.length - 1
    shown = [...bars.slice(Math.max(0, bars.length - room)), { text: ' ', fg: c.dim }, ...badge]
  } else {
    const bars = steps.map(bar)
    const last = bars[bars.length - 1]!
    bars[bars.length - 1] = blink(f) ? last : { ...last, fg: mix(last.fg, c.page, 0.75) }
    shown = bars.slice(Math.max(0, bars.length - W))
  }
  // The bars from the left, the current badge flush right.
  if (shown.length < W && badge.length + 1 <= W) {
    const bars = shown.slice(0, shown.length - badge.length)
    bars.forEach((s, x) => { row[x] = s })
    badge.forEach((s, j) => { row[W - badge.length + j] = s })
  } else shown.forEach((s, x) => { row[x] = s })
  return { segs: row, busy: 0 }
}

function badgesLook(f: Frame): Drawn {
  const { c } = f
  const W = f.width
  const stale = staleOf(f)
  const steps = f.steps
  const n = steps.length
  const row: Seg[] = Array.from({ length: W }, () => ({ text: ' ', fg: c.dim }))
  if (n === 0) return { segs: row, busy: 0 }
  const cur = jobCells(f, steps, n - 1, stale)
  const prev = n >= 2 ? jobCells(f, steps, n - 2, false) : null
  const since = f.now - steps[n - 1]!.t
  const outMs = prev ? (prev.length / OUT_CPS) * 1000 : 0
  const moving = f.live ? Math.max(0, outMs + (cur.length / IN_CPS) * 1000 - since) : 0
  const out = f.live && since < outMs
  const job = out ? prev! : cur
  const shift = !f.live ? 0 : out ? Math.floor((since / 1000) * OUT_CPS) : Math.max(0, cur.length - Math.floor(((since - outMs) / 1000) * IN_CPS))

  // Every finished block, the leaving one only once it has gone; a run of one colour is one badge.
  const done = steps.slice(0, out ? n - 2 : n - 1).map((m, i) => ({ m, ms: steps[i + 1]!.t - m.t }))
  const groups: { color: string; ms: number; count: number }[] = []
  for (const d of done) {
    const color = badgeOf(d.m, c).color
    const last = groups[groups.length - 1]
    if (last && last.color === color) {
      last.count++
      last.ms += d.ms
    } else groups.push({ color, ms: d.ms, count: 1 })
  }
  const label = (count: number, ms: number) => ` ${count > 1 ? `${count}×` : ''}${clockOf(ms)} `
  const room = Math.floor(W * BADGE_SHARE)
  const spanFrom = (from: number) => groups.slice(from).reduce((s, g) => s + label(g.count, g.ms).length, 0)
  // The oldest fold into one two-part badge: how many, then their time together. Steps the band
  // no longer sends (f.before) are always folded.
  const foldOf = (from: number) => {
    const hidden = groups.slice(0, from)
    const count = f.before.count + hidden.reduce((s, g) => s + g.count, 0)
    return count === 0 ? null : { count: ` +${count} `, time: ` ${clockOf(f.before.ms + hidden.reduce((s, g) => s + g.ms, 0))} ` }
  }
  const widthOf = (from: number) => { const fd = foldOf(from); return (fd ? fd.count.length + fd.time.length + 1 : 0) + spanFrom(from) }
  let from = 0
  while (from < groups.length && widthOf(from) > room) from++
  const keep = groups.length - from
  const fold = foldOf(from)
  const strip: Seg[] = []
  if (fold) strip.push(...cells([
    { text: fold.count, fg: c.foldInk, bg: c.foldCount, bold: true },
    { text: fold.time, fg: c.timeInk, bg: c.foldTime, bold: true },
    { text: ' ', fg: c.dim },
  ]))
  for (const g of groups.slice(groups.length - keep)) strip.push(...cells([{ text: label(g.count, g.ms), ...soft(g.color, c), bold: true }]))
  strip.forEach((s, x) => { if (x < W) row[x] = s })

  const max = W - strip.length - 1
  const shown = job.length <= max ? job : jobCells(f, steps, out ? n - 2 : n - 1, out ? false : stale, max).slice(-Math.max(0, max))
  shown.forEach((s, j) => {
    const x = W - shown.length + shift + j
    if (x >= strip.length && x < W) row[x] = s
  })
  return { segs: row, busy: moving }
}

// ── the module ────────────────────────────────────────────────────────────────

function merge(segs: readonly Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.fg === s.fg && last.bg === s.bg && last.bold === s.bold && last.italic === s.italic) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

/** The band's legend line: what each finished block's colour means, in the blocks' own faded fills. */
export type LegendProps = { legend: { name: string; color: string }[]; c: TimelineColors }

const Flow: ClientModule<FlowProps | LegendProps, FlowState> = (all, surface) => {
  const { Text } = surface.elements
  if ('legend' in all) {
    return Text({
      wrap: 'truncate-end',
      children: all.legend.flatMap((it, i) => {
        const ink = soft(it.color, all.c)
        return [...(i > 0 ? [Text({ children: ' ' })] : []), Text({ color: ink.fg, backgroundColor: ink.bg, bold: true, children: ` ${it.name} ` })]
      }),
    })
  }
  const props = all
  const s = surface.state
  // The run's clock at the band's render: its elapsed time, plus how long ago it ended.
  const clockAt = props.elapsed + props.endedFor
  const settledAt = (endedFor: number) => !props.live && endedFor >= SETTLE_MS
  if (s === undefined) {
    // The slow clock starts once, with the first state, unless the row has already settled; it
    // stops once the row settles, or with the instance. It stands aside while the fast one counts.
    if (!settledAt(props.endedFor)) {
      const stop = surface.every(SLOW_MS, () => {
        const now = surface.state
        if (!now) return
        if (now.halt) stop()
        else if (!now.fast) surface.setState({ ...now, ms: now.ms + SLOW_MS })
      })
    }
    surface.setState({ ms: 0, mount: clockAt, busyTo: 0, fast: false, halt: settledAt(props.endedFor) })
  }
  const ms = s?.ms ?? 0
  let t = (s?.mount ?? clockAt) + ms
  if (s !== undefined && Math.abs(t - clockAt) > DRIFT_MS) {
    // The cell's count fell behind (a hidden terminal throttles its clocks) or ran ahead: take the band's.
    surface.setState({ ...s, mount: clockAt - ms })
    t = clockAt
  }
  const lag = Math.max(0, t - clockAt) // how far the cell has counted on since the band's render
  const endedFor = props.endedFor + lag
  if (s !== undefined && !s.halt && settledAt(endedFor)) surface.setState({ ...s, halt: true })
  const f: Frame = {
    steps: props.steps,
    before: props.before,
    now: props.live ? props.elapsed + lag : props.elapsed,
    live: props.live,
    idle: props.live ? props.idle + Math.floor(lag / 1000) : 0,
    endedFor,
    ms,
    width: Math.max(8, surface.columns > 0 ? surface.columns : props.width),
    staleAfter: props.staleAfter,
    staleFull: props.staleFull,
    c: props.c,
  }
  const drawn = f.width < NARROW ? (f.live ? narrowLook(f) : endedLook(f))
    : props.look === 'line' ? lineLook(f)
    : f.live ? badgesLook(f) : endedLook(f)
  if (s !== undefined && drawn.busy > 0) {
    const busyTo = ms + drawn.busy
    if (!s.fast) {
      // Something moves: the fast clock counts until it stops, then hands back to the slow one.
      const stop = surface.every(FRAME_MS, () => {
        const now = surface.state
        if (!now || now.halt) return stop()
        const next = now.ms + FRAME_MS
        if (next >= now.busyTo) {
          stop()
          surface.setState({ ...now, ms: next, fast: false })
        } else surface.setState({ ...now, ms: next })
      })
      surface.setState({ ...(surface.state ?? s), busyTo, fast: true })
    } else if (busyTo > s.busyTo) surface.setState({ ...(surface.state ?? s), busyTo })
  }
  const segs = merge(drawn.segs)
  return Text({
    wrap: 'truncate-end',
    children: segs.map(g => Text({
      wrap: 'truncate-end',
      color: g.fg,
      ...(g.bg ? { backgroundColor: g.bg } : {}),
      ...(g.bold ? { bold: true } : {}),
      ...(g.italic ? { italic: true } : {}),
      children: g.text,
    })),
  })
}

export default Flow
