import { expect, type Engine } from "claude-code/testing";

export const SURFACES = ["terminal", "desktop"] as const;
export type Surface = typeof SURFACES[number];
export const SHOW_PANE_ID = "orchestrator-show";
export const ENGINE_DRAWING = { type: "Box", props: { key: "engine-own" }, children: [] };

export function bandProps(bodyColumns = 140, maxRows = 20, hasSurvey = false) {
  return { bodyColumns, maxRows, hasSurvey, isWorking: false, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} };
}
export function paneProps(bodyColumns = 100, bodyRows = 24, placement: "dock" | "inline" = "dock") {
  return { title: "orchestrator", isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows }, view: {} };
}
export const mountBand = ($: Engine, surface: Surface, props = bandProps()) =>
  $.ui.mount({ plugin: "orchestrator", surface, component: "AbovePrompt", props: props as never, viewport: { columns: props.bodyColumns, rows: 50, isFullscreen: true } });
export const mountPane = ($: Engine, surface: Surface, props = paneProps()) =>
  $.ui.mount({ plugin: "orchestrator", surface, component: "Pane", requestId: SHOW_PANE_ID, props: props as never });

export type Found = { type: string; key?: string; props: Record<string, unknown>; text: string; children: unknown[] };
export type Mounted = {
  findAll(query: { type?: string; key?: string; text?: string | RegExp }): Promise<Found[]>;
  drawn(): Promise<unknown>;
  press(target: { key: string }): Promise<unknown>;
};
type Node = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] };
export function walk(tree: unknown): Node[] {
  if (!tree || typeof tree !== "object") return [];
  const n = tree as Node;
  const children = n.children ?? n.props?.children ?? [];
  return [n, ...(Array.isArray(children) ? children.flat(Infinity) : [children]).flatMap(walk)];
}
export function engineOwn(tree: unknown): unknown {
  if (!tree || typeof tree !== "object") return tree;
  const { part, ...rest } = tree as { part?: { plugin?: unknown } };
  return part?.plugin === "test" && Object.keys(part).length === 1 ? rest : tree;
}
export async function textOf(m: Mounted): Promise<string> {
  return (await m.findAll({ type: "Text" })).map(n => n.text).join("\n");
}
export async function button(m: Mounted, label: string): Promise<Found | undefined> {
  return (await m.findAll({ type: "Button" })).find(b => b.props.label === label || b.text.trim() === label);
}
export async function press(m: Mounted, label: string): Promise<void> {
  const b = await button(m, label);
  expect(b).toBeDefined();
  expect(b?.key).toBeDefined();
  await m.press({ key: b!.key! });
}
// Locate by visible row/action text, using the rendered key only to activate it.
// No production key format or component hierarchy is an expectation.
function content(tree: unknown): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (!tree || typeof tree !== "object") return "";
  const node = tree as Node;
  const children = node.children ?? node.props?.children ?? [];
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(content).join(" ");
}
export async function rowAction(m: Mounted, label: string, action: string): Promise<string | undefined> {
  const tree = await m.drawn();
  for (const group of walk(tree).reverse()) {
    if (!content(group).includes(label)) continue;
    const buttons = walk(group).filter(n => n.type === "Button");
    if (!buttons.some(n => n.props?.label === "Show")) continue;
    const node = buttons.find(n => n.props?.label === action);
    const key = node?.key ?? node?.props?.key;
    return typeof key === "string" ? key : undefined;
  }
  return undefined;
}
export async function pressRow(m: Mounted, label: string, action: string): Promise<void> {
  const key = await rowAction(m, label, action);
  expect(key).toBeDefined();
  await m.press({ key: key! });
}
