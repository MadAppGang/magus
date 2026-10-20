// The badges' colours, as madbench draws its badges (madbench internal/tui/theme.go): one hue
// per meaning, a solid half (the hue, with whichever of white or ink reads better on it) and a
// quiet half (the hue tinted toward the page). Theme keys carry no tints of blue, teal or violet,
// so the badges and the value text use these raw colours, picked by the person's Claude Code theme
// (paletteFor). The rest of the band keeps theme keys.

export type Hue = 'run' | 'ask' | 'done' | 'fail' | 'format' | 'stopped' | 'model' | 'tools' | 'loops' | 'cost'
export type Ink = { fg: string; bg: string }
/** solid and quiet: a badge's two halves; text: the hue alone, for coloured text with no fill;
 *  tokensIn / tokensOut: the tokens badge's two halves, two greens (black text on light, white on dark). */
export type Palette = {
  solid: Readonly<Record<Hue, Ink>>; quiet: Readonly<Record<Hue, Ink>>; text: Readonly<Record<Hue, string>>
  tokensIn: Ink; tokensOut: Ink
  timeline: TimelineColors
}

/**
 * The live cell's colours (flow.tsx), raw, since it draws on its own thread and reads no theme:
 * each tool family's badge, the kinds' badges, the words, pac-man and the ghost, the silence's
 * three steps, the fold badge, and the page the faded runs fade toward.
 */
export type TimelineColors = {
  read: string; edit: string; run: string; web: string; agent: string; other: string
  think: string; say: string; ask: string; done: string; fail: string; finish: string
  words: string; dim: string; ink: string; timeInk: string; page: string
  pac: string; pacQuiet: string; ghost: string; ghost2: string
  ok: string; warn: string; bad: string
  /** a job's time once its fill turns amber or red for silence */
  silenceInk: string
  foldCount: string; foldTime: string; foldInk: string
}

// Tool families as the preview settled them: teal reads, gold edits, pink runs, blue reaches the
// web, orange hands work to an agent or an MCP tool. The fold badge is steel blue. Pac-man is the
// orange-gold that reads on a cream page and a dark one.
const TIMELINE_LIGHT: TimelineColors = {
  read: '#0D9488', edit: '#A16207', run: '#BE185D', web: '#0369A1', agent: '#C2410C', other: '#4B5563',
  think: '#7C3AED', say: '#6D28D9', ask: '#B45309', done: '#166534', fail: '#B91C1C', finish: '#15803D',
  words: '#4B5068', dim: '#8F94AC', ink: '#FFFFFF', timeInk: '#0B0B12', page: '#FFFFFF',
  pac: '#E8890C', pacQuiet: '#A8743A', ghost: '#B91C1C', ghost2: '#BE185D',
  ok: '#166534', warn: '#B45309', bad: '#B91C1C', silenceInk: '#FFFFFF',
  foldCount: '#3D59A1', foldTime: '#7AA2F7', foldInk: '#FFFFFF',
}
const TIMELINE_DARK: TimelineColors = {
  read: '#4FD6BE', edit: '#FFD479', run: '#F38BA8', web: '#7DCFFF', agent: '#FF9E64', other: '#D8DAE5',
  think: '#B794F6', say: '#C4A7F8', ask: '#FFB454', done: '#22E06B', fail: '#FF4D5E', finish: '#7EE2A0',
  words: '#9AA0BC', dim: '#5A5E78', ink: '#0B0B12', timeInk: '#0B0B12', page: '#16171D',
  pac: '#FFD23F', pacQuiet: '#A8743A', ghost: '#FF4D5E', ghost2: '#FF8AD8',
  ok: '#22E06B', warn: '#FFB454', bad: '#FF4D5E', silenceInk: '#FFFFFF',
  foldCount: '#3D59A1', foldTime: '#7AA2F7', foldInk: '#FFFFFF',
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
  return { solid, quiet, text: hues, ...(light ? TOKENS_LIGHT : TOKENS_DARK), timeline: light ? TIMELINE_LIGHT : TIMELINE_DARK }
}

export const LIGHT_PALETTE: Palette = build(LIGHT, true)
export const DARK_PALETTE: Palette = build(DARK, false)

/**
 * The palette for the person's Claude Code theme (`light`, `dark-ansi`, …). `auto` follows the
 * terminal, whose background a mod cannot ask; there, as tt does, TERM_THEME (`light` or `dark`)
 * decides, then COLORFGBG's background (7 or 15 is light), and dark otherwise.
 */
export function paletteFor(theme: unknown, termTheme?: string, colorFgBg?: string): Palette {
  const name = typeof theme === 'string' ? theme : ''
  if (name.startsWith('light')) return LIGHT_PALETTE
  if (name.startsWith('dark')) return DARK_PALETTE
  const stated = termTheme?.trim().toLowerCase()
  if (stated === 'light') return LIGHT_PALETTE
  if (stated === 'dark') return DARK_PALETTE
  const bg = colorFgBg?.split(';').pop()
  return bg === '7' || bg === '15' ? LIGHT_PALETTE : DARK_PALETTE
}
