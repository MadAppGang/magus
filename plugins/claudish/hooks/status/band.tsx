// The band above the prompt: a pure tree builder. Values and closures in, a tree out;
// it reads no state, writes none, and calls only the actions it was given, from onPress.
// Every Text truncates (never wraps), every colour is a theme key.

import type { Elements, RenderElement } from 'claude-code'
import { STOP_CELLS, SHOW_CELLS, rowCells, type BandModel, type BandRow, type Segment, type SlotTarget } from './layout'

/** The elements the band and the tab draw with: in every surface's table. */
export type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type BandActions = {
  stop(target: SlotTarget): void
  show(target: SlotTarget): void
}

/** Segments as one outer Text: one truncation for the whole line, a nested Text per coloured run. */
export function segmentsText(els: Els, segments: readonly Segment[]): RenderElement {
  const { Text } = els
  return (
    <Text wrap="truncate-end">
      {segments.map((s, i) => (
        <Text key={`seg:${i}`} wrap="truncate-end" {...(s.color ? { color: s.color } : {})} {...(s.dim ? { dimColor: true } : {})} {...(s.bold ? { bold: true } : {})}>
          {s.text}
        </Text>
      ))}
    </Text>
  ) as RenderElement
}

function row(els: Els, r: BandRow, model: BandModel, actions: BandActions): RenderElement {
  const { Box, Text, Button } = els
  const plan = model.plan!
  const c = rowCells(r, plan)
  const t = (text: string, props: Record<string, unknown> = {}) => <Text wrap="truncate-end" {...props}>{text}</Text>
  const stop = r.stop === 'stop' ? <Button key={`stop:${r.key}`} label="Stop" onPress={() => actions.stop(r.target)} />
    : r.stop === 'confirm' ? <Button key={`stop:${r.key}`} label="confirm?" variant="primary" onPress={() => actions.stop(r.target)} />
    : r.stop === 'stopping' ? t('stopping…', { dimColor: true })
    : null
  return (
    <Box key={`row:${r.key}`} flexDirection="row" gap={1}>
      {t(c.lead, r.attention ? { color: 'permission' } : {})}
      {plan.id > 0 && t(c.id)}
      {t(c.state, { color: r.color })}
      {plan.model > 0 && t(c.model)}
      {plan.provider > 0 && t(c.provider, { dimColor: true })}
      {plan.tokens > 0 && t(c.tokens, { dimColor: true })}
      {plan.tools > 0 && t(c.tools, { dimColor: true })}
      {plan.loops > 0 && t(c.loops, { dimColor: true })}
      {plan.idle > 0 && t(c.idle, r.idle.color ? { color: r.idle.color } : {})}
      {plan.activity > 0 && t(c.activity, { dimColor: true })}
      <Box width={STOP_CELLS} flexShrink={0}>{stop}</Box>
      <Box width={SHOW_CELLS} flexShrink={0}>
        {r.show && <Button key={`show:${r.key}`} label="Show" onPress={() => actions.show(r.target)} />}
      </Box>
    </Box>
  ) as RenderElement
}

/** The band: the header, one row per slot fitted to the band's width, and a fold line. */
export function bandTree(els: Els, model: BandModel, actions: BandActions): RenderElement {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      {segmentsText(els, model.header)}
      {model.plan !== null && model.rows.map(r => row(els, r, model, actions))}
      {model.more !== null && <Text wrap="truncate-end" dimColor>{`  ${model.more}`}</Text>}
    </Box>
  ) as RenderElement
}
