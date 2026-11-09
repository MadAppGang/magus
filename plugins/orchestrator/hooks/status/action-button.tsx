// The mod's one button component: `[ label ]`, bold, no fill, in its variant's theme colour.
// The band and the pane draw every button through it and name a variant, never a colour, so
// the button's look is defined here once.

import type { Elements, RenderElement } from 'claude-code'

/** The elements the band and the pane draw with. */
export type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/**
 * `primary`: moves within the orchestrator (Show, Jump, List, More, Prev, Next).
 * `secondary`: leaves it or puts it away (Open, Msg, Hide).
 */
export type ActionButtonVariant = 'primary' | 'secondary'

const VARIANT_COLOR: Readonly<Record<ActionButtonVariant, string>> = { primary: 'ide', secondary: 'suggestion' }

/** A button: `[ label ]` in its variant's colour. */
export function actionButton(els: Els, key: string, label: string, variant: ActionButtonVariant, onPress: () => void): RenderElement {
  const { Button, Text } = els
  return (
    <Button key={key} plain label={label} onPress={onPress}>
      <Text wrap="truncate-end" color={VARIANT_COLOR[variant]} bold>{`[ ${label} ]`}</Text>
    </Button>
  ) as RenderElement
}

/** A fixed-width cell holding a button, or the same width blank when the row has no such action. */
export function actionButtonCell(els: Els, key: string, width: number, label: string, variant: ActionButtonVariant, onPress: (() => void) | null): RenderElement {
  const { Box } = els
  return (
    <Box key={`cell:${key}`} width={width} flexShrink={0}>
      {onPress !== null && actionButton(els, key, label, variant, onPress)}
    </Box>
  ) as RenderElement
}
