// The band above the prompt: a pure tree builder. Values and closures in, a tree out; it reads
// no state, writes none, and calls only the actions it was given, from onPress. Every Text
// truncates, never wraps.

import type { RenderElement } from 'claude-code'
import type { OrchestratorStatus } from '../../types'
import { actionButton, actionButtonCell, type Els } from './action-button'
import { BUTTON_CELLS, type BandModel, type BandRow, type CellPlan } from './layout'

export type RowActionsFns = {
  jump(key: string): void
  show(key: string): void
  open(key: string): void
  msg(key: string): void
}

export type BandActions = RowActionsFns & {
  /** opens the pane's session list */
  more(): void
  /** puts the pane away */
  hide(): void
}

/** A status's theme colour; none for the quiet ones. */
export function statusColor(status: OrchestratorStatus, needsYou: boolean): string | undefined {
  if (needsYou) return 'warning'
  switch (status) {
    case 'working':
      return 'success'
    case 'gone':
      return 'error'
    default:
      return undefined
  }
}

function cell(els: Els, key: string, width: number, text: string, props: Record<string, unknown> = {}): RenderElement {
  const { Box, Text } = els
  return (
    <Box key={key} width={width} flexShrink={0}>
      <Text wrap="truncate-end" {...props}>{text}</Text>
    </Box>
  ) as RenderElement
}

function row(els: Els, r: BandRow, plan: CellPlan, actions: BandActions): RenderElement {
  const { Box, Text } = els
  const color = statusColor(r.status, r.needsYou)
  const tint = color ? { color } : {}
  const lead = plan.indent > 0 ? `${r.indent}${r.glyph}` : r.glyph
  return (
    <Box key={`row:${r.key}`} flexDirection="row" gap={1}>
      {cell(els, 'lead', plan.indent + 1, lead, tint)}
      {cell(els, 'label', plan.label, r.label, r.isSelf ? { bold: true } : r.adopted ? { dimColor: true } : {})}
      {plan.role > 0 && cell(els, 'role', plan.role, r.role, { dimColor: true })}
      {plan.ticket > 0 && cell(els, 'ticket', plan.ticket, r.ticket, { dimColor: true })}
      {cell(els, 'status', plan.status, r.statusText, tint)}
      {plan.progress > 0 && cell(els, 'progress', plan.progress, r.progress)}
      <Box key="waits" flexGrow={1} flexShrink={1}>
        {plan.waits > 0 && r.waits !== '' && <Text wrap="truncate-end" dimColor>{r.waits}</Text>}
      </Box>
      {plan.jump > 0 && actionButtonCell(els, `jump:${r.key}`, BUTTON_CELLS.jump, 'Jump', 'primary', r.actions.jump ? () => actions.jump(r.key) : null)}
      {actionButtonCell(els, `show:${r.key}`, BUTTON_CELLS.show, 'Show', 'primary', () => actions.show(r.key))}
      {plan.open > 0 && actionButtonCell(els, `open:${r.key}`, BUTTON_CELLS.open, 'Open', 'secondary', r.actions.open ? () => actions.open(r.key) : null)}
      {plan.msg > 0 && actionButtonCell(els, `msg:${r.key}`, BUTTON_CELLS.msg, 'Msg', 'secondary', r.actions.msg ? () => actions.msg(r.key) : null)}
    </Box>
  ) as RenderElement
}

/** The band: the header (Hide while the pane is open), the rows that fit, and `+N more [More]`. */
export function bandTree(els: Els, model: BandModel, actions: BandActions): RenderElement {
  const { Box, Text } = els
  const moreButton = actionButton(els, 'more', 'More', 'primary', () => actions.more())
  return (
    <Box flexDirection="column">
      <Box key="header" flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" bold {...(model.needYou > 0 ? { color: 'warning' } : {})}>{model.header}</Text>
        </Box>
        {model.moreInHeader && <Box flexShrink={0}>{moreButton}</Box>}
        {model.panelOpen && <Box flexShrink={0}>{actionButton(els, 'hide', 'Hide', 'secondary', () => actions.hide())}</Box>}
      </Box>
      {model.rows.map(r => row(els, r, model.plan, actions))}
      {model.more > 0 && !model.moreInHeader && (
        <Box key="more" flexDirection="row" gap={1}>
          <Text wrap="truncate-end" dimColor>{`  +${model.more} more`}</Text>
          <Box flexShrink={0}>{moreButton}</Box>
        </Box>
      )}
    </Box>
  ) as RenderElement
}
