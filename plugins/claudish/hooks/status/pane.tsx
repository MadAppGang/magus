// A Show tab: a pure tree builder over paneModel's output. Box and Text only: the tab
// takes no action at all (the read-only guarantee is structural; there is no Button and no
// input). Every frame colour arrives already spelled from layout.ts; the header and notes
// use theme keys only.

import type { RenderElement } from 'claude-code'
import { segmentsText, type Els } from './band'
import type { PaneLine, PaneModel } from './layout'

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

/** The tab: a header row, then the child's screen, or why there is none. */
export function paneTree(els: Els, model: PaneModel): RenderElement {
  const { Box, Text } = els
  const body = model.body
  return (
    <Box flexDirection="column">
      {segmentsText(els, model.header)}
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
