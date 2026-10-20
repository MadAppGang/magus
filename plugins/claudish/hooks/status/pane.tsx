// The Show panel: a pure tree builder over showTabs and paneModel. Its one action is picking a
// tab: the child's screen stays read-only (no Input anywhere, and the only Buttons are the tabs).
// Every frame colour arrives already spelled from layout.ts; the header and notes use theme keys.

import type { RenderElement } from 'claude-code'
import { badgeParts, segmentsText, type Els } from './band'
import type { Palette } from './palette'
import { CODE_CELLS, RUNTIME_CELLS, type PaneLine, type PaneModel, type ShowTab, type SlotTarget } from './layout'

function frameLine(els: Els, line: PaneLine, row: number): RenderElement {
  const { Text } = els
  const blank = line.every(part => (typeof part === 'string' ? part : part.text) === '')
  if (blank) return (<Text key={`line:${row}`} wrap="truncate-end">{' '}</Text>) as RenderElement
  return (
    <Text key={`line:${row}`} wrap="truncate-end">
      {line.map((part, i) => (typeof part === 'string' ? part : (
        <Text
          key={`part:${i}`}
          {...(part.color !== undefined ? { color: part.color } : {})}
          {...(part.backgroundColor !== undefined ? { backgroundColor: part.backgroundColor } : {})}
          {...(part.bold ? { bold: true } : {})}
        >
          {part.text}
        </Text>
      )))}
    </Text>
  ) as RenderElement
}

/**
 * The tab strip, as tt draws its tabs: each label after a dot in its slot's status colour, a thin
 * bar between them, the active one bold on a pale fill; a rule under the strip. Pressing a tab
 * shows it.
 */
function tabStrip(els: Els, tabs: readonly ShowTab[], active: string | null, columns: number, palette: Palette, select: (target: SlotTarget) => void): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box key="tabs" flexDirection="column">
      <Box flexDirection="row">
        {tabs.map((tab, i) => {
          const on = tab.id === active
          return (
            <Box key={`tab:${tab.id}`} flexDirection="row" flexShrink={on ? 0 : 1}>
              {i > 0 && <Text wrap="truncate-end" color="subtle">│</Text>}
              <Button plain label={tab.label} onPress={() => select(tab.target)}>
                <Text wrap="truncate-end" {...(on ? { backgroundColor: palette.quiet.run.bg } : {})}>
                  <Text color={palette.text[tab.hue]}>{' ●'}</Text>
                  <Text {...(on ? { color: palette.text.run, bold: true } : { color: 'inactive' })}>{` ${tab.label} `}</Text>
                </Text>
              </Button>
            </Box>
          )
        })}
      </Box>
      <Text wrap="truncate-end" color="subtle">{'─'.repeat(Math.max(1, columns))}</Text>
    </Box>
  ) as RenderElement
}

/** The panel: the tab strip, then the active tab's header row and its child's screen, or why there is none. */
export function panelTree(
  els: Els,
  tabs: readonly ShowTab[],
  active: string | null,
  model: PaneModel | null,
  columns: number,
  palette: Palette,
  select: (target: SlotTarget) => void,
): RenderElement {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      {tabStrip(els, tabs, active, columns, palette, select)}
      {model ? paneTree(els, model, palette) : <Text wrap="truncate-end" dimColor>No run to show.</Text>}
    </Box>
  ) as RenderElement
}

/** One tab's body: a header row, then the child's screen, or why there is none. */
export function paneTree(els: Els, model: PaneModel, palette: Palette): RenderElement {
  const { Box, Text } = els
  const body = model.body
  return (
    <Box flexDirection="column">
      {segmentsText(els, model.header, model.badge ? badgeParts(els, palette, model.badge, ` ${model.badge.code.padEnd(CODE_CELLS - 2)} `, ` ${model.badge.runtime.padStart(RUNTIME_CELLS - 2)} `) : [])}
      {body.kind === 'waiting' && <Text wrap="truncate-end" dimColor>Waiting for the first screen…</Text>}
      {body.kind === 'unavailable' && <Text wrap="truncate-end" dimColor>{body.note}</Text>}
      {body.kind === 'unavailable' && body.numbers !== '' && <Text wrap="truncate-end" dimColor>{body.numbers}</Text>}
      {body.kind === 'note' && body.note !== '' && <Text wrap="truncate-end" dimColor>{body.note}</Text>}
      {body.kind === 'frame' && (
        <Box key="frame" flexDirection="column">
          {body.lines.map((line, row) => frameLine(els, line, row))}
        </Box>
      )}
    </Box>
  ) as RenderElement
}
