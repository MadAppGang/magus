// The allowance row and its forecast panel as trees: pure builders. The row is the segments
// allowance-row.ts laid out, one space, then the row's button, drawn by the band's own `button` so
// it reads as every other `[ Show ]`; the panel is the lines forecast.ts laid out under a header
// with Hide. They read no state, write none, and call only the actions they were given, from onPress.
//
// The row is always the band's top row and begins with the rate cell; its button's key is
// `show:allowance` (a run row's is `show:<run key>`), which tells the two `[ Show ]`s apart.

import type { RenderElement } from 'claude-code'
import { button, type Els } from './band'
import { SHOW_CELLS, type PaneLine, type PaneSegment } from './layout'
import { frameLine } from './pane'

/** The allowance row's button key. */
export const ALLOWANCE_BUTTON_KEY = 'show:allowance'

export type AllowanceRow = { segments: PaneSegment[]; cells: number }

export type AllowanceActions = {
  /** opens the forecast panel */
  show(): void
  /** puts the forecast panel away */
  hide(): void
}

/** The forecast panel's Hide key: told apart from the Show panel's `hide-panel`. */
export const FORECAST_HIDE_KEY = 'hide-forecast'

/**
 * The forecast panel: a header row (its title, then Hide at the right edge, drawn as the Show
 * panel's Hide: Claude Code's own close mark is one cell and hard to hit), a rule, then the lines
 * forecast.ts laid out, each one truncating Text.
 */
export function forecastTree(els: Els, title: string, lines: readonly PaneLine[], columns: number, hide: () => void): RenderElement {
  const { Box, Text } = els
  const width = Math.max(1, columns)
  return (
    <Box flexDirection="column">
      <Box key="forecast:head" flexDirection="row" width={width}>
        <Box flexGrow={1}><Text wrap="truncate-end" bold>{title}</Text></Box>
        <Box width={SHOW_CELLS} flexShrink={0}>{button(els, FORECAST_HIDE_KEY, 'Hide', { color: 'suggestion', bold: true }, hide)}</Box>
      </Box>
      <Text key="forecast:rule" wrap="truncate-end" color="subtle">{'─'.repeat(width)}</Text>
      <Box key="forecast:body" flexDirection="column">
        {lines.map((line, row) => frameLine(els, line, row))}
      </Box>
    </Box>
  ) as RenderElement
}

/**
 * The row: its segments in a box that grows to the row's width, then `[ Show ]`, or `[ Hide ]`
 * while its panel is open (inks as the run band's), so the button sits at the last column even
 * when the row dropped its ruler.
 */
export function allowanceRowTree(els: Els, row: AllowanceRow, open: boolean, actions: AllowanceActions): RenderElement {
  const { Box } = els
  return (
    <Box key="allowance" flexDirection="row" gap={1}>
      <Box flexGrow={1} flexShrink={1}>{frameLine(els, row.segments, 0)}</Box>
      <Box width={SHOW_CELLS} flexShrink={0}>
        {open
          ? button(els, ALLOWANCE_BUTTON_KEY, 'Hide', { color: 'suggestion', bold: true }, () => actions.hide())
          : button(els, ALLOWANCE_BUTTON_KEY, 'Show', { color: 'ide', bold: true }, () => actions.show())}
      </Box>
    </Box>
  ) as RenderElement
}
