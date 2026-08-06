/**
 * theme/tokens.ts — the semantic palette. Hex is the public dialect.
 *
 * Ported verbatim from the `go-tui` skill so a Go TUI and a Bun TUI built from
 * these two skills look identical. Never scatter hex literals in components:
 * import a token. If a value you need is missing, add a token HERE first — a
 * one-off literal in a component is how a palette stops being a palette. Colour
 * maths lives in `./color`; `RGBA` appears only in the intent tier at the bottom.
 */
import { RGBA } from "@opentui/core"

/**
 * Severity / status, then chrome. A token means ONE thing across the whole app:
 * red is error everywhere, or glanceability dies.
 *
 * `dead` and `subtle` are deliberately the same hex. They mean different things
 * and may diverge, so they keep separate names.
 */
export const tokens: Record<
  | "fatal" | "error" | "warn" | "info" | "debug" | "trace"
  | "success" | "running" | "idle" | "dead"
  | "border" | "subtle" | "text" | "accent" | "bgPanel" | "ink",
  string
> = {
  fatal: "#FF5555", //   catastrophic
  error: "#FF6B6B", //   recoverable error
  warn: "#FFB454", //    warning
  info: "#5AC8FF", //    normal / informational
  debug: "#8A8FA0", //   verbose
  trace: "#5C6070", //   dimmest
  success: "#2ECC71", // ok / passed
  running: "#3498DB", // active / healthy
  idle: "#95A5A6", //    waiting
  dead: "#6C7086", //    offline
  border: "#45475A", //  panel borders — recede
  subtle: "#6C7086", //  labels, units — recede
  text: "#CDD6F4", //    body text
  accent: "#89B4FA", //  focus / titles
  bgPanel: "#1E1E2E", // panel background
  ink: "#11111B", //     text on bright badges
}

/**
 * A gradient's STOPS — AT LEAST ONE, and that bound is load-bearing rather than
 * pedantic. `blendStops` answers `[]` for an empty stop list, which is right for it and
 * fatal downstream: `Meter` painted one cell per ramp entry, so `ramp={[]}` type-checked
 * and rendered a ZERO-WIDTH meter — 40 columns asked for, none painted, nothing thrown.
 * A non-empty tuple makes that call a COMPILE error. A computed `string[]` no longer
 * fits: annotate it `Ramp` or `as const` it, which is the right pressure — a ramp is a
 * designed object, not an array that happens to hold colours. */
export type Ramp = readonly [string, ...string[]]

/**
 * Gradient STOPS, not ramps. Feed them to `blendStops(cells, ...stops)` so the
 * ramp is computed at the meter's real width — a 3-entry array is 3 stops, never
 * 3 buckets. Colour encodes POSITION along the fill here, so it must be smooth.
 */
export const ramps: { load: Ramp; temperature: Ramp; network: Ramp } = {
  load: [tokens.success, "#F1C40F", "#E74C3C"],
  temperature: [tokens.running, tokens.success, "#FF8C00", "#E91E63"],
  network: [tokens.success, "#F1C40F", "#E74C3C"],
}

/** HTTP method colours (the `posting` look). Use as badge backgrounds. */
export const methods: Record<string, string> = {
  GET: "#61AFFE",
  POST: "#49CC90",
  PUT: "#FCA130",
  PATCH: "#50E3C2",
  DELETE: "#F8615C",
  OPTIONS: "#9013FE",
}

/**
 * Optional second tier that OpenTUI has and Lip Gloss does not: colour INTENT.
 * `defaultForeground` / `defaultBackground` stay bound to the user's terminal
 * theme slots and fall back to the snapshot hex, so chrome tracks their theme
 * while signal colours stay literal — red must be red in every theme. These are
 * `RGBA`: pass them straight to `fg` / `bg`, never into `./color`, which is
 * hex-in/hex-out and would flatten the intent back to a literal.
 */
export const chromeIntent = {
  text: RGBA.defaultForeground(tokens.text),
  bgPanel: RGBA.defaultBackground(tokens.bgPanel),
} as const
