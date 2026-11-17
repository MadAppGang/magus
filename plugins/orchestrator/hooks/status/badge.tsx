// The mod's one badge: its text padded by a space each side on a solid theme fill, in inverse
// ink, bold. The band and the pane draw every badge through it, so the look is defined once.

import type { RenderElement } from 'claude-code'
import type { OrchestratorStatus } from '../../types'
import type { Els } from './action-button'
import { ROLE_FILL, STATUS_FILL } from './domain'

/** A badge: ` text ` on `fill`. */
export function badge(els: Els, key: string, text: string, fill: string): RenderElement {
  const { Text } = els
  return (
    <Text key={key} wrap="truncate-end" color="inverseText" backgroundColor={fill} bold>{` ${text} `}</Text>
  ) as RenderElement
}

/** A status's badge fill: `warning` while the row needs the user. */
export function statusFill(status: OrchestratorStatus, needsYou: boolean): string {
  return needsYou ? 'warning' : STATUS_FILL[status]
}

/** The status badge, then its age as text in the badge's colour. */
export function statusBadge(els: Els, key: string, status: OrchestratorStatus, needsYou: boolean, age: string): RenderElement {
  const { Text } = els
  const fill = statusFill(status, needsYou)
  return (
    <Text key={key} wrap="truncate-end">
      {badge(els, 'state', status, fill)}
      {age !== '' && <Text key="age" wrap="truncate-end" color={fill} bold>{` ${age}`}</Text>}
    </Text>
  ) as RenderElement
}

/** A role badge: its letter on the role's fill. */
export function roleBadge(els: Els, key: string, role: keyof typeof ROLE_FILL, letter: string): RenderElement {
  return badge(els, key, letter, ROLE_FILL[role])
}
