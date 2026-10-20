// The band above the prompt: a pure tree builder. Values and closures in, a tree out;
// it reads no state, writes none, and calls only the actions it was given, from onPress.
// Every Text truncates (never wraps). The live cell is a surface module (flow.tsx), so its
// timeline animates without the band redrawing.

import type { Elements, RenderElement } from 'claude-code'
import type { Ink, Palette } from './palette'
import { STALE_NUMBER_S, STALE_STEPS_S } from './domain'
import { legendOf, type FlowProps, type LegendProps } from './flow'
import { LEAD_CELLS, STOP_CELLS, SHOW_CELLS, rowCells, type Badge, type BandModel, type BandRow, type Segment, type SlotTarget } from './layout'

/** How the live cell draws a slot's timeline: the person's pick in /config (the plugin's `timeline` option). */
export type TimelineLook = FlowProps['look']

/** The elements the band and the panel draw with: in every surface's table, but `Client`, which a
 *  remote surface leaves out (the meter is then drawn still). */
export type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Client?: Elements['terminal']['Client'] }

export type BandActions = {
  stop(target: SlotTarget): void
  /** opens the Show panel on this slot's tab, or moves the open panel to it */
  show(target: SlotTarget): void
  /** puts the Show panel away */
  hide(): void
}

function segmentProps(s: Segment): Record<string, unknown> {
  return {
    ...(s.color ? { color: s.color } : {}),
    ...(s.backgroundColor ? { backgroundColor: s.backgroundColor } : {}),
    ...(s.dim ? { dimColor: true } : {}),
    ...(s.bold ? { bold: true } : {}),
  }
}

/** Segments as one outer Text: one truncation for the whole line, a nested Text per coloured run. */
export function segmentsText(els: Els, segments: readonly Segment[], lead: RenderElement[] = []): RenderElement {
  const { Text } = els
  return (
    <Text wrap="truncate-end">
      {lead}
      {segments.map((s, i) => (
        <Text key={`seg:${i}`} wrap="truncate-end" {...segmentProps(s)}>
          {s.text}
        </Text>
      ))}
    </Text>
  ) as RenderElement
}

/** One half of a badge: its text on its fill, bold, as madbench draws its badges. */
function half(els: Els, key: string, text: string, ink: Ink, bold = true): RenderElement {
  const { Text } = els
  return (<Text key={key} wrap="truncate-end" color={ink.fg} backgroundColor={ink.bg} {...(bold ? { bold: true } : {})}>{text}</Text>) as RenderElement
}

/** The status badge: the code on its hue's solid fill, then the runtime as text in the same hue, no fill. */
export function badgeParts(els: Els, palette: Palette, badge: Badge, code: string, runtime: string): RenderElement[] {
  const { Text } = els
  const parts = [half(els, 'code', code, palette.solid[badge.hue])]
  if (runtime !== '') parts.push((<Text key="runtime" wrap="truncate-end" color={palette.text[badge.hue]}>{runtime}</Text>) as RenderElement)
  return parts
}

/**
 * A button, drawn as one: `[ label ]` in its colour, no fill, so it never reads as a badge. An
 * armed Stop fills (its second press cancels). Pressed by a click, or Enter once the band has the keys.
 */
export function button(els: Els, key: string, label: string, ink: { color: string; backgroundColor?: string; bold?: boolean }, onPress: () => void): RenderElement {
  const { Button, Text } = els
  return (
    <Button key={key} plain label={label} onPress={onPress}>
      <Text wrap="truncate-end" color={ink.color} {...(ink.backgroundColor ? { backgroundColor: ink.backgroundColor } : {})} {...(ink.bold ? { bold: true } : {})}>{`[ ${label} ]`}</Text>
    </Button>
  ) as RenderElement
}

function row(els: Els, r: BandRow, model: BandModel, actions: BandActions, palette: Palette, look: TimelineLook): RenderElement {
  const { Box, Client, Text } = els
  const plan = model.plan!
  const c = rowCells(r, plan)
  const t = (text: string, props: Record<string, unknown> = {}) => <Text wrap="truncate-end" {...props}>{text}</Text>
  const stop = r.stop === 'stop' ? button(els, `stop:${r.key}`, 'Stop', { color: 'error', bold: true }, () => actions.stop(r.target))
    : r.stop === 'confirm' ? button(els, `stop:${r.key}`, 'Stop?', { color: 'inverseText', backgroundColor: 'error', bold: true }, () => actions.stop(r.target))
    : r.stop === 'stopping' ? t('stopping…', { dimColor: true })
    : null
  return (
    <Box key={`row:${r.key}`} flexDirection="row" gap={1}>
      {t(c.lead, r.attention ? { color: 'permission' } : {})}
      {plan.id > 0 && t(c.id, { dimColor: true })}
      <Text wrap="truncate-end">{badgeParts(els, palette, r.badge, c.code, c.runtime)}</Text>
      {/* The model badge, its provider and the stats block: one block, no gap inside. */}
      <Box flexDirection="row">
        {plan.model > 0 && (r.model === '' ? t(' '.repeat(plan.model + plan.provider)) : (
          <Text wrap="truncate-end">
            {half(els, 'model', c.model, palette.solid.model)}
            {plan.provider > 0 && half(els, 'provider', c.provider, palette.quiet.model)}
          </Text>
        ))}
        {plan.tokens + plan.tools + plan.loops + plan.cost > 0 && (
          // One block of badges, no gap inside: tokens on two pale greens, then tool calls, loops
          // and cost, each on its hue's quiet tint. The cells (rowCells) carry the padding.
          <Text wrap="truncate-end">
            {plan.tokens > 0 && (r.tokensOut === ''
              ? half(els, 'in', c.tokensIn, palette.tokensIn, false)
              : <Text key="tokens" wrap="truncate-end">{half(els, 'in', c.tokensIn, palette.tokensIn, false)}{half(els, 'out', c.tokensOut, palette.tokensOut, false)}</Text>)}
            {plan.tools > 0 && half(els, 'tools', c.tools, palette.quiet.tools)}
            {plan.loops > 0 && half(els, 'loops', c.loops, palette.quiet.loops)}
            {plan.cost > 0 && half(els, 'cost', c.cost, palette.quiet.cost)}
          </Text>
        )}
      </Box>
      {plan.activity > 0 && t(c.activity, { dimColor: true })}
      {/* The live cell takes every free cell up to the buttons: the slot's timeline, live or ended.
          Where the surface draws no module, the stale-meter stands still. */}
      {plan.meter > 0 && r.trail !== null && Client ? (
        <Client
          key={`timeline:${r.key}`}
          module="./flow.tsx"
          width={plan.meter}
          props={{
            look, steps: r.trail.steps, before: r.trail.before, elapsed: r.trail.elapsed, live: r.trail.live, idle: r.trail.idle, endedFor: r.trail.endedFor,
            staleAfter: STALE_NUMBER_S, staleFull: STALE_STEPS_S[STALE_STEPS_S.length - 1]!, width: plan.meter, c: palette.timeline,
          } satisfies FlowProps}
        />
      ) : plan.meter > 0 ? (
        <Box flexGrow={1}>{r.meter !== null && t(`${c.meter}${c.meterNumber}`, { color: r.meter.color })}</Box>
      ) : null}
      {/* With the meter column dropped there is no spacer (it would cost a gap the plan does not
          count): the buttons' own box grows and holds them right. */}
      <Box flexShrink={0} flexDirection="row" gap={1} {...(plan.meter > 0 ? {} : { flexGrow: 1, justifyContent: 'flex-end' })}>
        {plan.stop > 0 && <Box width={STOP_CELLS} flexShrink={0} justifyContent="flex-end">{stop}</Box>}
        <Box width={SHOW_CELLS} flexShrink={0}>
          {r.show && button(els, `show:${r.key}`, 'Show', r.active ? { color: 'inverseText', backgroundColor: 'ide', bold: true } : { color: 'ide', bold: true }, () => actions.show(r.target))}
        </Box>
      </Box>
    </Box>
  ) as RenderElement
}

/** What the finished blocks' colours mean, under the rows, while a live row draws them; none once every row has ended. */
function legend(els: Els, model: BandModel, palette: Palette, look: TimelineLook): RenderElement | null {
  const { Box, Client } = els
  if (look !== 'badges' || !Client || !model.plan || model.plan.meter <= 0) return null
  const live = model.rows.flatMap(r => (r.trail?.live ? [r.trail.steps] : []))
  const items = legendOf(live, palette.timeline)
  if (items.length === 0) return null
  // Drawn by the timeline's module, which owns the faded fills; the band itself draws only theme keys.
  return (
    <Box key="legend" flexDirection="row">
      <Box width={LEAD_CELLS} flexShrink={0} />
      <Client key="legend" module="./flow.tsx" props={{ legend: items, c: palette.timeline } satisfies LegendProps} />
    </Box>
  ) as RenderElement
}

/** The band: the header (with Hide while the Show panel is open), one row per slot fitted to the band's width, and a fold line. */
export function bandTree(els: Els, model: BandModel, actions: BandActions, palette: Palette, look: TimelineLook = 'badges'): RenderElement {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      <Box key="header" flexDirection="row">
        <Box flexGrow={1}>{segmentsText(els, model.header)}</Box>
        {model.panelOpen && <Box width={SHOW_CELLS} flexShrink={0}>{button(els, 'hide', 'Hide', { color: 'suggestion', bold: true }, () => actions.hide())}</Box>}
      </Box>
      {model.plan !== null && model.rows.map(r => row(els, r, model, actions, palette, look))}
      {model.more !== null && <Text wrap="truncate-end" dimColor>{`  ${model.more}`}</Text>}
      {model.plan !== null && legend(els, model, palette, look)}
    </Box>
  ) as RenderElement
}
