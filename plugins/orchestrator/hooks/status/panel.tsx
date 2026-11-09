// The pane: a pure tree builder over listModel and sessionModel. The session list carries a
// line per family session with its buttons and a pager; one session shows its status,
// dependencies, holds, tasks and a read-only screen. No Input anywhere.

import type { RenderElement } from 'claude-code'
import { actionButton, actionButtonCell, type Els } from './action-button'
import { BUTTON_CELLS, type ListModel, type SessionLine, type SessionModel } from './layout'
import { statusColor, type RowActionsFns } from './band'

export type PanelActions = RowActionsFns & {
  /** back to the session list, at a page */
  list(page: number): void
  hide(): void
}

function headerRow(els: Els, title: string, buttons: RenderElement[]): RenderElement {
  const { Box, Text } = els
  return (
    <Box key="head" flexDirection="row" gap={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" bold>{title}</Text>
      </Box>
      {buttons.map((b, i) => (
        <Box key={`hb:${i}`} flexShrink={0}>{b}</Box>
      ))}
    </Box>
  ) as RenderElement
}

function listTree(els: Els, model: ListModel, actions: PanelActions): RenderElement {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      {headerRow(els, model.title, [actionButton(els, 'hide', 'Hide', 'secondary', () => actions.hide())])}
      {model.lines.map(l => {
        const color = statusColor(l.status, l.needsYou)
        return (
          <Box key={`line:${l.key}`} flexDirection="row" gap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" {...(color ? { color } : {})} {...(l.isSelf ? { bold: true } : {})}>{l.text}</Text>
            </Box>
            {actionButtonCell(els, `show:${l.key}`, BUTTON_CELLS.show, 'Show', 'primary', () => actions.show(l.key))}
            {actionButtonCell(els, `jump:${l.key}`, BUTTON_CELLS.jump, 'Jump', 'primary', l.actions.jump ? () => actions.jump(l.key) : null)}
            {actionButtonCell(els, `open:${l.key}`, BUTTON_CELLS.open, 'Open', 'secondary', l.actions.open ? () => actions.open(l.key) : null)}
            {actionButtonCell(els, `msg:${l.key}`, BUTTON_CELLS.msg, 'Msg', 'secondary', l.actions.msg ? () => actions.msg(l.key) : null)}
          </Box>
        )
      })}
      {(model.prev || model.next) && (
        <Box key="pager" flexDirection="row" gap={1}>
          {model.prev && actionButton(els, 'prev', 'Prev', 'primary', () => actions.list(model.page - 1))}
          {model.next && actionButton(els, 'next', 'Next', 'primary', () => actions.list(model.page + 1))}
        </Box>
      )}
    </Box>
  ) as RenderElement
}

function detailLine(els: Els, l: SessionLine, i: number): RenderElement {
  const { Text } = els
  const color = l.tone === 'error' ? 'error' : l.tone === 'attention' ? 'warning' : undefined
  return (
    <Text key={`d:${i}`} wrap="truncate-end" {...(l.dim ? { dimColor: true } : {})} {...(color ? { color } : {})}>
      {l.text === '' ? ' ' : l.text}
    </Text>
  ) as RenderElement
}

function sessionTree(els: Els, model: SessionModel, columns: number, actions: PanelActions): RenderElement {
  const { Box, Text } = els
  const key = model.key
  const buttons: RenderElement[] = [actionButton(els, 'list', 'List', 'primary', () => actions.list(0))]
  if (model.actions.jump) buttons.push(actionButton(els, 'jump', 'Jump', 'primary', () => actions.jump(key)))
  if (model.actions.open) buttons.push(actionButton(els, 'open', 'Open', 'secondary', () => actions.open(key)))
  if (model.actions.msg) buttons.push(actionButton(els, 'msg', 'Msg', 'secondary', () => actions.msg(key)))
  buttons.push(actionButton(els, 'hide', 'Hide', 'secondary', () => actions.hide()))
  return (
    <Box flexDirection="column">
      {headerRow(els, model.title, buttons)}
      <Text key="status" wrap="truncate-end" {...(model.needsYou ? { color: 'warning' } : {})}>{model.status}</Text>
      {model.details.map((l, i) => detailLine(els, l, i))}
      <Text key="rule" wrap="truncate-end" color="subtle">{'─'.repeat(Math.max(1, columns))}</Text>
      {model.note !== null && <Text key="note" wrap="truncate-end" dimColor>{model.note}</Text>}
      {model.screen.map((line, i) => (
        <Text key={`s:${i}`} wrap="truncate-end">{line === '' ? ' ' : line}</Text>
      ))}
    </Box>
  ) as RenderElement
}

/** The pane's tree: the session list or one session. */
export function panelTree(els: Els, model: ListModel | SessionModel, columns: number, actions: PanelActions): RenderElement {
  return model.kind === 'list' ? listTree(els, model, actions) : sessionTree(els, model, columns, actions)
}
