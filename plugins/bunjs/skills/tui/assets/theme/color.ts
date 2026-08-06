/**
 * theme/color.ts — the colour maths OpenTUI does not ship.
 *
 * Verified absent from `@opentui/core`: `lerp`, `mix`, `blend1D`, `gradient`,
 * `lighten`, `darken`, `saturate`, `rgbToHsv`. `setCellWithAlphaBlending` and
 * `respectAlpha` are COMPOSITING — a translucent cell over what is beneath it —
 * not interpolation between two colours. A gradient needs interpolation, so
 * "blend" in the OpenTUI docs never means what `lipgloss.Blend1D` means. OpenTUI
 * itself needed `darken` and hand-rolled it privately, unexported.
 *
 * BOUNDARY: hex in, hex out. `RGBA` is internal maths only, so components never
 * learn a third dialect on top of "core vs React". Every value returned here is
 * a LOWERCASE `#rrggbb` string — compare case-insensitively against the
 * uppercase literals in `./tokens`.
 *
 * Surface-neutral: pure functions, no renderables, no JSX. This is bridge site
 * B2 — it imports from core and calls no construct.
 */
import { parseColor, rgbToHex, RGBA, type ColorInput } from "@opentui/core"
import { tokens } from "./tokens"

/** `.r/.g/.b/.a` on `RGBA` are normalised 0..1, NOT 0..255. `toInts()` is 0..255. */
const rgba = (c: ColorInput): RGBA => parseColor(c)
const hex = (c: RGBA): string => rgbToHex(c)
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/**
 * Linear interpolation in RGB (gamma-space sRGB), `t` clamped to 0..1. The whole engine.
 *
 * RGB SPACE IS A DELIBERATE CHOICE, NOT AN OVERSIGHT, and it has one real cost: a
 * two-stop blend between distant hues desaturates through the middle. MEASURED on
 * `blend1D(24, success, error)` — HSV saturation 0.775 and 0.580 at the ends, **0.304**
 * at the midpoint (`#929e6e`, a muddy olive). Gamma-corrected interpolation gives
 * `#bea56e` (sat 0.421) and Oklab `#bca56e` (sat 0.415), so the criticism is correct on
 * its own terms. Three reasons it still stays:
 *
 * 1. **Every ramp this skill ships already routes around it, on purpose.** `ramps.load`
 *    and `ramps.network` put an explicit `#F1C40F` between the green and the red;
 *    `ramps.temperature` has four stops. Measured across all 40 cells of
 *    `blendStops(40, ...ramps.load)`, minimum saturation is **0.564** — nearly double the
 *    two-stop midpoint. `blendStops` exists so the midtone is CHOSEN rather than
 *    computed, which beats any colour space: a designer picking the control point can
 *    place it where the data needs it, and no interpolation can.
 * 2. **`heatRamp` is a one-hue brightness ramp, where RGB is the RIGHT space.** It is a
 *    straight line toward black, so hue order is preserved exactly (measured: r ≥ g ≥ b
 *    holds across all 24 steps of `heatRamp(tokens.error)`, saturation 0.578–0.594).
 *    Switching spaces would move every heat cell — for a same-hue pair the midpoint goes
 *    from `#803636` to `#bc4d4d` — so the 0.80 floor would stop reading as "almost
 *    nothing" and the documented `lipgloss.Blend1D(24, Darken(hue, 0.80), hue)` parity
 *    with the go-tui skill would be gone.
 * 3. **`darken`/`lighten` scale RGB channels.** A perceptual `mix` beside gamma-space
 *    darkening is an inconsistency that shows up as ramps whose ends do not match the
 *    tokens they were built from.
 *
 * So: nothing here is "exact colour maths" in a perceptual sense, and this file does not
 * claim to be. It is sRGB channel interpolation, correct at both endpoints and smooth per
 * cell, which is what the per-cell fill rule needs. For a value-encoding scale where
 * midtone fidelity matters, `aesthetics-and-color.md` already gives the right answer and
 * it is not a colour space: use DISCRETE BUCKETS, not a continuous ramp.
 */
function mix(a: RGBA, b: RGBA, t: number): string {
  const k = clamp01(t)
  return hex(
    RGBA.fromValues(
      a.r + (b.r - a.r) * k,
      a.g + (b.g - a.g) * k,
      a.b + (b.b - a.b) * k,
      a.a + (b.a - a.a) * k,
    ),
  )
}

/**
 * `steps` colours from `from` to `to`, BOTH ENDPOINTS INCLUSIVE.
 *
 *   out.length === steps · out[0] === from · out[steps - 1] === to
 *   out[i] === lerp(from, to, i / (steps - 1))
 *
 * `blend1D(1, a, b)` → `[a]` — a single sample takes the `from` end, so there is
 * no division by zero. `blend1D(0, …)` → `[]`. Negative or non-integer `steps`
 * → `[]`. "Does not throw" is not a specification; these are the values.
 *
 * This is the shim that makes the smooth-fill rule achievable: ONE COLOUR PER
 * CELL is what reads as continuous. Call it with the meter's width, not with 4.
 */
export function blend1D(steps: number, from: ColorInput, to: ColorInput): string[] {
  if (!Number.isInteger(steps) || steps <= 0) return []
  const a = rgba(from)
  if (steps === 1) return [hex(a)]
  const b = rgba(to)
  return Array.from({ length: steps }, (_, i) => mix(a, b, i / (steps - 1)))
}

/**
 * Multi-stop ramp — btop's green→yellow→red load meter, a staleness scale.
 * `steps` colours spread evenly across every stop in order, endpoints inclusive.
 *
 * 0 stops → `[]`. 1 stop → that stop repeated `steps` times. `steps === 1` → the
 * first stop only, matching `blend1D`'s single-sample rule.
 */
export function blendStops(steps: number, ...stops: ColorInput[]): string[] {
  if (!Number.isInteger(steps) || steps <= 0 || stops.length === 0) return []
  if (stops.length === 1 || steps === 1) return blend1D(steps, stops[0]!, stops.at(-1)!)
  const pts = stops.map(rgba)
  const segs = pts.length - 1
  return Array.from({ length: steps }, (_, i) => {
    const p = (i / (steps - 1)) * segs
    const s = Math.min(segs - 1, Math.floor(p))
    return mix(pts[s]!, pts[s + 1]!, p - s)
  })
}

/**
 * Scale toward black by `amount`, clamped to 0..1. `0.80` is the heat-ramp
 * floor — dark enough to read as "almost nothing", tinted enough to keep the
 * row's hue identity.
 */
export function darken(c: ColorInput, amount: number): string {
  const k = 1 - clamp01(amount)
  const v = rgba(c)
  return hex(RGBA.fromValues(v.r * k, v.g * k, v.b * k, v.a))
}

/** Scale toward white by `amount`, clamped to 0..1. */
export function lighten(c: ColorInput, amount: number): string {
  const k = clamp01(amount)
  const v = rgba(c)
  return hex(
    RGBA.fromValues(v.r + (1 - v.r) * k, v.g + (1 - v.g) * k, v.b + (1 - v.b) * k, v.a),
  )
}

/**
 * Dark-but-TINTED floor → full hue, `steps` deep (default 24). Exactly
 * `blend1D(steps, darken(hue, 0.80), hue)` — the same numbers as the go-tui
 * skill's `lipgloss.Blend1D(24, Darken(hue, 0.80), hue)`, so a heat row is
 * pixel-comparable across the two skills.
 *
 * Hue is fixed for the row (the row scans as one severity); only brightness
 * varies per column (the row reads as magnitude over time).
 *
 * Built in RGB, and not by choice: `hsvToRgb` is public but there is NO
 * `rgbToHsv`, so you cannot ask OpenTUI for the hue of an existing token. Reach
 * for `hsvToRgb` only when GENERATING a palette from an HSV seed.
 */
export function heatRamp(hue: ColorInput, steps = 24): string[] {
  return blend1D(steps, darken(hue, 0.8), hue)
}

/**
 * WCAG 2.x relative luminance. `.r/.g/.b` are already gamma-encoded sRGB in 0..1,
 * which is exactly what the formula takes.
 *
 * This is the ONE place in this file that leaves gamma space, and it does so only to
 * answer a yes/no question — which of two inks is legible — never to produce a
 * blended colour. Nothing above it becomes "exact colour maths" because of it:
 * `mix` is still sRGB channel interpolation and still says so.
 */
function luminance(c: RGBA): number {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(clamp01(c.r)) + 0.7152 * f(clamp01(c.g)) + 0.0722 * f(clamp01(c.b))
}

/** WCAG contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrastRatio(a: RGBA, b: RGBA): number {
  const [x, y] = [luminance(a), luminance(b)]
  return x >= y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05)
}

/** Source-over composite of `fg` onto an OPAQUE `bg` — what the terminal does when
 * it paints a translucent cell. Opaque `fg` short-circuits, so the common path
 * costs nothing and returns the caller's own colour object unchanged. */
function over(fg: RGBA, bg: RGBA): RGBA {
  const a = clamp01(fg.a)
  if (a >= 1) return fg
  return RGBA.fromValues(
    fg.r * a + bg.r * (1 - a),
    fg.g * a + bg.g * (1 - a),
    fg.b * a + bg.b * (1 - a),
    1,
  )
}

/**
 * The more legible of two inks for text sitting on `bg`: whichever has the HIGHER
 * WCAG CONTRAST RATIO against it. Not a brightness threshold — the thing the
 * threshold was a proxy for, measured directly.
 *
 * A fixed YIQ cut at 128 does not survive saturated hues, because YIQ weights green
 * far more heavily than perceived luminance does. MEASURED on the old rule:
 * `#ff00ff` took the light ink at **2.17:1** when the dark ink gives **5.98:1**, and
 * `#808080` took **2.73:1** over **4.75:1** — a magenta badge and a plain grey badge,
 * both illegible. Inverting the threshold does not fix this and is how the bug came
 * back once already: `#ff00ff` has YIQ L=105 (dark side of the cut) yet needs the
 * DARK ink, so no threshold in either direction gets both it and `tokens.bgPanel`
 * right. Only comparing the two candidates does.
 *
 * ALPHA. `Badge.bg` takes any `ColorInput`, so `bg` may be translucent, and the old
 * rule read the channels of an invisible colour. A translucent `bg` is composited
 * over `tokens.bgPanel` first — the surface it is actually painted on — and each ink
 * is then composited over that result, so the ratio compares the colours the
 * terminal will really show. Fully transparent therefore picks the ink for the panel
 * itself, which is the right answer rather than a coin toss.
 *
 * Returns the composited, OPAQUE ink, keeping this file's `#rrggbb` boundary: an
 * 8-digit hex would leak straight into `fg=` and re-composite a second time.
 */
export function pickInk(
  bg: ColorInput,
  dark: ColorInput = tokens.ink,
  light: ColorInput = tokens.text,
): string {
  const surface = over(rgba(bg), rgba(tokens.bgPanel))
  const inkDark = over(rgba(dark), surface)
  const inkLight = over(rgba(light), surface)
  return hex(contrastRatio(inkDark, surface) >= contrastRatio(inkLight, surface) ? inkDark : inkLight)
}
