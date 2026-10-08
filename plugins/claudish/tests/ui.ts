// Mounting helpers for the band and the Show tab, and a walk over a drawn tree. The props
// are the engine's own shapes for the two sites (AbovePrompt, Pane).

import type { RenderElement } from 'claude-code'

export const PLUGIN = 'claudish'
export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

export function bandProps(bodyColumns = 140, maxRows = 20, hasSurvey = false) {
  return { hasSurvey, isWorking: false, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} }
}

export function paneProps(bodyColumns = 80, bodyRows = 20) {
  return { title: 'pane', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} }
}

type Mountable = {
  ui: {
    mount: (target: { plugin: string; surface: Surface; component: 'AbovePrompt' | 'Pane'; props: never; requestId?: string }) => Promise<unknown>
  }
}

/** The band on `surface`, drawn through the plugins. */
export async function mountBand($: unknown, surface: Surface, props = bandProps()) {
  const m = ($ as Mountable).ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: props as never })
  return (await m) as Mounted
}

/** The Show tab `id` on `surface`, drawn through the plugins. */
export async function mountPane($: unknown, surface: Surface, id: string, props = paneProps()) {
  const m = ($ as Mountable).ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: props as never, requestId: id })
  return (await m) as Mounted
}

export type Found = { type: string; key: string | undefined; props: Record<string, unknown>; text: string; children: unknown[] }

export type Mounted = {
  drawn(): Promise<RenderElement>
  find(q: { type?: string; key?: string; text?: string | RegExp }): Promise<Found | undefined>
  findAll(q: { type?: string; key?: string; text?: string | RegExp }): Promise<Found[]>
  press(t: { key: string }): Promise<unknown>
  redraw(props?: unknown): Promise<void>
  unmount(): Promise<void>
}

/** A node of a drawn tree, as plain data. */
export type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function childrenOf(n: Node): unknown[] {
  const c = n.children ?? (n.props?.children as unknown[] | undefined) ?? []
  return Array.isArray(c) ? c.flat(Infinity) : [c]
}

/** Every element of a drawn tree, depth first, with whether it sits under `Box key="frame"`. */
export function walk(tree: unknown): { node: Node; inFrame: boolean; depth: number }[] {
  const out: { node: Node; inFrame: boolean; depth: number }[] = []
  const go = (n: unknown, inFrame: boolean, depth: number) => {
    if (n === null || typeof n !== 'object') return
    const node = n as Node
    const key = (node.props?.key ?? (node as { key?: unknown }).key) as unknown
    const frame = inFrame || (node.type === 'Box' && key === 'frame')
    out.push({ node, inFrame, depth })
    for (const c of childrenOf(node)) go(c, frame, depth + 1)
  }
  go(tree, false, 1)
  return out
}

/** The text a Found element shows, every row of a mounted drawing. */
export async function texts(m: Mounted, q: { type?: string; text?: string | RegExp } = { type: 'Text' }): Promise<string[]> {
  return (await m.findAll(q)).map(f => f.text)
}
