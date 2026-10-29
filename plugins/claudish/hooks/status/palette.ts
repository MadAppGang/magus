// The badges' colours, as madbench draws its badges (madbench internal/tui/theme.go): one hue
// per meaning, a solid half (the hue, with whichever of white or ink reads better on it) and a
// quiet half (the hue tinted toward the page). Theme keys carry no tints of blue, teal or violet,
// so the badges and the value text use these raw colours, light or dark by the Magus status line's
// order (paletteFor). The rest of the band keeps theme keys. The allowance row and its forecast
// panel draw only from `allowance` (AllowanceColors).

export type Hue = 'run' | 'ask' | 'done' | 'fail' | 'format' | 'stopped' | 'model' | 'tools' | 'loops' | 'cost'
export type Ink = { fg: string; bg: string }
/** solid and quiet: a badge's two halves; text: the hue alone, for coloured text with no fill;
 *  tokensIn / tokensOut: the tokens badge's two halves, two greens (black text on light, white on dark). */
export type Palette = {
  solid: Readonly<Record<Hue, Ink>>; quiet: Readonly<Record<Hue, Ink>>; text: Readonly<Record<Hue, string>>
  tokensIn: Ink; tokensOut: Ink
  timeline: TimelineColors
  allowance: AllowanceColors
}

/**
 * The allowance row's and the forecast panel's colours (allowance-row.ts, forecast.ts), raw, as
 * the 2026-10-27 allowance band design chose them. profiles: one vivid hue per account number,
 * clear of the meaning colours (green, amber, red); under / over: the pace gauge's heat, two to
 * four steps below and above safe pace; track: a mini meter's unlit cells; rule: the ruler's line;
 * chipInk: the text on a filled chip. page is only the base the tints mix toward: the row paints
 * no background of its own. tintGauge / tintBadge: how far an unlit gauge cell and a badge's quiet
 * half travel toward the page. tintFaded: how far a predicted cell of the forecast panel's relay
 * strip travels toward the page: the design (forecast-panel.ts) draws those faint (SGR 2) on a
 * grey fog; the mod paints no fog, so the faint half-step toward the page is all that marks them.
 */
export type AllowanceColors = {
  profiles: readonly [string, string, string, string]
  ok: string; warn: string; bad: string
  under: readonly [string, string, string]; over: readonly [string, string, string]
  text: string; dim: string; track: string; rule: string; chipInk: string; page: string
  tintGauge: number; tintBadge: number; tintFaded: number
  /**
   * The NEXT SWITCH card's account badge: the name on the solid profile colour, then its windows on
   * two steps of that colour toward the page (the first window, then the rest), written in `text`
   * (the profile colour on its own mid tint reads under 3:1).
   */
  tintSegment: readonly [first: number, rest: number]
}

/**
 * The live cell's colours (flow.tsx), raw, since it draws on its own thread and reads no theme:
 * each tool family's badge, the kinds' badges, the words, pac-man and the ghost, the silence's
 * three steps, and the page the legend chips fade toward.
 */
export type TimelineColors = {
  read: string; edit: string; run: string; web: string; agent: string; other: string
  think: string; say: string; ask: string; done: string; fail: string; finish: string
  words: string; dim: string; ink: string; timeInk: string; page: string
  pac: string; pacQuiet: string; ghost: string; ghost2: string
  ok: string; warn: string; bad: string
  /** a job's time once its fill turns amber or red for silence */
  silenceInk: string
}

// Tool families as the preview settled them: teal reads, gold edits, pink runs, blue reaches the
// web, orange hands work to an agent or an MCP tool. Pac-man is the
// orange-gold that reads on a cream page and a dark one.
const TIMELINE_LIGHT: TimelineColors = {
  read: '#0D9488', edit: '#A16207', run: '#BE185D', web: '#0369A1', agent: '#C2410C', other: '#4B5563',
  think: '#7C3AED', say: '#4D7C0F', ask: '#B45309', done: '#166534', fail: '#B91C1C', finish: '#15803D',
  words: '#4B5068', dim: '#8F94AC', ink: '#FFFFFF', timeInk: '#0B0B12', page: '#FFFFFF',
  pac: '#E8890C', pacQuiet: '#A8743A', ghost: '#B91C1C', ghost2: '#BE185D',
  ok: '#166534', warn: '#B45309', bad: '#B91C1C', silenceInk: '#FFFFFF',
}
const TIMELINE_DARK: TimelineColors = {
  read: '#4FD6BE', edit: '#FFD479', run: '#F38BA8', web: '#7DCFFF', agent: '#FF9E64', other: '#D8DAE5',
  think: '#B794F6', say: '#A3E635', ask: '#FFB454', done: '#22E06B', fail: '#FF4D5E', finish: '#7EE2A0',
  words: '#9AA0BC', dim: '#5A5E78', ink: '#0B0B12', timeInk: '#0B0B12', page: '#16171D',
  pac: '#FFD23F', pacQuiet: '#A8743A', ghost: '#FF4D5E', ghost2: '#FF8AD8',
  ok: '#22E06B', warn: '#FFB454', bad: '#FF4D5E', silenceInk: '#FFFFFF',
}

// madbench's stops: azure, honey, lime, coral, gold, pending grey; indigo (the model, as madbench's id
// badge), teal, iris, gold (cost). Tokens take two fixed pale fills instead (TOKENS_LIGHT/DARK).
const LIGHT: Readonly<Record<Hue, string>> = {
  run: '#1D4ED8', ask: '#92400E', done: '#166534', fail: '#B91C1C', format: '#A16207',
  stopped: '#8F94AC', model: '#4338CA', tools: '#0D9488', loops: '#7C3AED', cost: '#A16207',
}
const DARK: Readonly<Record<Hue, string>> = {
  run: '#89B4FA', ask: '#FFB454', done: '#22E06B', fail: '#FF4D5E', format: '#FFD479',
  stopped: '#5A5E78', model: '#5B6CE0', tools: '#4FD6BE', loops: '#B794F6', cost: '#FFD479',
}
const SNOW = '#FFFFFF'
const INK = '#0B0B12'

// The tokens badge recedes: two pale greens, a diff's added line (sent) and its added word (received),
// sampled from the person's reference; written in black. On a dark page, the same two sunk dark, in white.
const TOKENS_LIGHT = { tokensIn: { fg: INK, bg: '#CDFFD3' }, tokensOut: { fg: INK, bg: '#95FFA6' } }
const TOKENS_DARK = { tokensIn: { fg: SNOW, bg: '#0F592A' }, tokensOut: { fg: SNOW, bg: '#16803D' } }

// How far a hue travels for a light page's quiet half: the fill toward white, the text toward black.
const LIGHT_FILL_TINT = 0.82
const LIGHT_QUIET_TEXT = 0.38
// A dark page's quiet half: the hue sunk toward black, written in white.
const DARK_QUIET_FILL = 0.55

type Rgb = readonly [number, number, number]

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** WCAG relative luminance. */
function luminance(c: string): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgb(c)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** A colour moved toward the allowance page by k (0 = the colour, 1 = the page): an unlit or quiet cell. */
export function tint(color: string, c: AllowanceColors, k: number): string {
  return mix(color, c.page, k)
}

// The allowance colours (the design's band.ts). A mod cannot ask the terminal for its background
// (OSC 11), so the tints mix toward the fallback pages, the same as the timeline's. The ruler's
// line is the text a quarter of the way to the page, as the design draws it.
const ALLOWANCE_RULE_TINT = 0.25

function allowanceColors(base: Omit<AllowanceColors, 'rule'>): AllowanceColors {
  return { ...base, rule: mix(base.text, base.page, ALLOWANCE_RULE_TINT) }
}

export const ALLOWANCE_DARK: AllowanceColors = allowanceColors({
  profiles: ['#B07CFF', '#4D9DFF', '#22D3EE', '#F472B6'],
  ok: '#22E06B', warn: '#FFB454', bad: '#FF4D5E',
  under: ['#FFD166', '#FFB454', '#FF9A3C'], over: ['#FACC15', '#FB923C', '#FF4D5E'],
  text: '#D8DAE5', dim: '#9AA0BC', track: '#3A3D4E', chipInk: '#0B0B12', page: TIMELINE_DARK.page,
  tintGauge: 0.72, tintBadge: 0.72, tintFaded: 0.5, tintSegment: [0.6, 0.8],
})
export const ALLOWANCE_LIGHT: AllowanceColors = allowanceColors({
  profiles: ['#7C3AED', '#2563EB', '#0891B2', '#DB2777'],
  ok: '#16A34A', warn: '#B45309', bad: '#B91C1C',
  under: ['#A16207', '#B45309', '#C2410C'], over: ['#CA8A04', '#EA580C', '#B91C1C'],
  text: '#0B0B12', dim: '#4B5068', track: '#D4D6E0', chipInk: '#FFFFFF', page: TIMELINE_LIGHT.page,
  tintGauge: 0.78, tintBadge: 0.84, tintFaded: 0.5, tintSegment: [0.55, 0.84],
})

/** White or ink, whichever reads better on the fill: madbench's badgeInk. */
function inkOn(fill: string): string {
  return contrast(SNOW, fill) >= contrast(INK, fill) ? SNOW : INK
}

function build(hues: Readonly<Record<Hue, string>>, light: boolean): Palette {
  const solid = {} as Record<Hue, Ink>
  const quiet = {} as Record<Hue, Ink>
  for (const [k, h] of Object.entries(hues) as [Hue, string][]) {
    solid[k] = { fg: inkOn(h), bg: h }
    quiet[k] = light
      ? { fg: mix(h, '#000000', LIGHT_QUIET_TEXT), bg: mix(h, SNOW, LIGHT_FILL_TINT) }
      : { fg: SNOW, bg: mix(h, '#000000', DARK_QUIET_FILL) }
  }
  return {
    solid, quiet, text: hues, ...(light ? TOKENS_LIGHT : TOKENS_DARK),
    timeline: light ? TIMELINE_LIGHT : TIMELINE_DARK, allowance: light ? ALLOWANCE_LIGHT : ALLOWANCE_DARK,
  }
}

export const LIGHT_PALETTE: Palette = build(LIGHT, true)
export const DARK_PALETTE: Palette = build(DARK, false)

export type Appearance = 'light' | 'dark'

/**
 * The tmux list-clients format the appearance is read with: per client attached to the pane's
 * session, its last activity, the mode the dotfiles' tmux theme.sh decided for it (`@theme_dark`,
 * 1 dark, 0 light; empty without theme.sh) and the theme the terminal reported (`client_theme`).
 */
export const TMUX_THEME_FORMAT = '#{client_activity} #{E:@theme_dark} #{client_theme}'

/**
 * The appearance tmux says for the client showing this pane's session, from list-clients output in
 * TMUX_THEME_FORMAT, as the Magus status line reads it (setup's statusline.sh, tmux_client_theme):
 * the most recently active client; its `@theme_dark` 1 dark, 0 light, else its `client_theme`
 * when exactly `light` or `dark`. An empty field shifts the rest left, so a lone light|dark after
 * the activity is the report. Null for anything else: no client, no report, an unknown word.
 */
export function tmuxClientAppearance(stdout: string): Appearance | null {
  let best: string[] | undefined
  let bestAt = Number.NEGATIVE_INFINITY
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/).filter(f => f !== '')
    if (fields.length === 0) continue
    const at = Number(fields[0])
    const activity = Number.isFinite(at) ? at : 0 // as `sort -rn` ranks a field that is no number
    if (best === undefined || activity > bestAt) {
      best = fields
      bestAt = activity
    }
  }
  if (best === undefined) return null
  let [, decided, reported] = best
  if (decided === 'light' || decided === 'dark') {
    reported = decided
    decided = undefined
  }
  if (decided === '1') return 'dark'
  if (decided === '0') return 'light'
  return reported === 'light' || reported === 'dark' ? reported : null
}

/**
 * The palette by the Magus status line's order (setup's statusline.sh, "Appearance detection"),
 * first answer wins: inside tmux, the appearance of the client showing this pane (`tmux`, from
 * tmuxClientAppearance; null says nothing), since tmux follows the screen the session is shown on
 * now; then TERM_THEME, only `light` or `dark`, trimmed, any case (anything else says nothing);
 * then dark. Claude Code's own `theme` setting is not read: it is shared by every session, so one
 * session's choice would repaint another's screen. COLORFGBG is not read either: it is frozen at
 * launch and is not a signal (the dotfiles' house rule).
 */
export function paletteFor(tmux: Appearance | null, termTheme?: string): Palette {
  if (tmux === 'light') return LIGHT_PALETTE
  if (tmux === 'dark') return DARK_PALETTE
  const stated = termTheme?.trim().toLowerCase()
  return stated === 'light' ? LIGHT_PALETTE : DARK_PALETTE
}
