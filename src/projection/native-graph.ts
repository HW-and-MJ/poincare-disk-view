import type { C } from "../geometry.ts";
import type { ItemView } from "obsidian";

export interface Circle {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
  labelOpacity: number;
  labelSize: number;
  labelOffset: number;
  hop?: number;
  bundle?: number;
  tile?: C[];
  tileOpacity?: number;
}

export interface Connection {
  source: string;
  target: string;
  color: string;
  opacity: number;
  width: number;
  /** The arc midpoint's signed offset from the chord, in units of half the chord length. */
  bend: number;
}

export interface Frame {
  width: number;
  height: number;
  nodes: Map<string, Circle>;
  links: Map<string, Connection>;
  ringOpacity: number;
  grid?: C[][];
  gridOpacity?: number;
}

interface NativeColor { rgb?: number; a?: number }
interface NativeGraphic {
  tint?: number;
  alpha?: number;
  visible?: boolean;
}

interface NativeNode {
  id: string;
  x?: number;
  y?: number;
  rendered?: boolean;
  circle?: NativeGraphic;
  text?: NativeGraphic & { y?: number; scale?: { x?: number }; style?: { fontSize?: number } };
  getSize?: () => number;
  getFillColor?: () => NativeColor;
  getDisplayText?: () => string;
}

interface NativeRenderer {
  containerEl: HTMLElement;
  width: number;
  height: number;
  panX: number;
  panY: number;
  scale: number;
  nodeScale: number;
  fLineSizeMult?: number;
  textAlpha?: number;
  colors?: { fill?: NativeColor; text?: NativeColor; line?: NativeColor };
  px?: { renderer?: { width?: number } } | null;
  nodes: NativeNode[];
  links: { source?: NativeNode; target?: NativeNode; line?: NativeGraphic }[];
}

export const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const numberOr = (n: unknown, fallback: number) => finite(n) ? n : fallback;
const opacityOf = (n: unknown, fallback: number) => clamp(numberOr(n, fallback), 0, 1);
const colorOf = (n: unknown, fallback: string) => finite(n) && n >= 0 && n <= 0xffffff
  ? "#" + Math.round(n).toString(16).padStart(6, "0") : fallback;
const edgeKey = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a]);

export interface NativeSnapshot {
  frame: Frame;
  textColor: string;
  edgeColor: string;
}

/** Read-only adapter for the desktop Graph renderer. Unknown shapes return null. */
export function readNativeGraph(view: ItemView): NativeSnapshot | null {
  const host = view.contentEl;
  const r = (view as ItemView & { renderer?: Partial<NativeRenderer> }).renderer;
  if (!r || r.containerEl !== host || !r.px || !Array.isArray(r.nodes) || !Array.isArray(r.links) ||
      !finite(r.width) || !finite(r.height) || r.width < 1 || r.height < 1 ||
      !finite(r.scale) || r.scale <= 0 || !finite(r.nodeScale) || r.nodeScale <= 0 ||
      !finite(r.panX) || !finite(r.panY)) return null;

  const dpr = numberOr(r.px.renderer?.width, r.width) / r.width;
  if (!finite(dpr) || dpr < 0.5 || dpr > 8) return null;
  const zoom = r.scale / dpr;
  const style = host.win.getComputedStyle(host);
  const themeColor = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const fill = colorOf(r.colors?.fill?.rgb, themeColor("--graph-node", "#777"));
  const edgeColor = colorOf(r.colors?.line?.rgb, themeColor("--graph-line", "#888"));
  const textColor = colorOf(r.colors?.text?.rgb, themeColor("--text-normal", "#444"));
  const nodes = new Map<string, Circle>();
  for (const n of r.nodes) {
    if (!n || typeof n.id !== "string" || !finite(n.x) || !finite(n.y)) continue;
    const color = n.getFillColor?.();
    const size = numberOr(n.getSize?.(), 8);
    const radius = Math.max(0.3, size * r.nodeScale * zoom);
    const labelSize = numberOr(n.text?.style?.fontSize, 14 + size / 4)
      * numberOr(n.text?.scale?.x, r.nodeScale) * zoom;
    const labelOffset = finite(n.text?.y) ? (n.text.y - n.y) * zoom : radius + 4;
    nodes.set(n.id, {
      id: n.id,
      label: n.getDisplayText?.() ?? n.id.replace(/^.*\//, "").replace(/\.md$/, ""),
      x: n.x * zoom + r.panX / dpr,
      y: n.y * zoom + r.panY / dpr,
      radius,
      color: colorOf(n.circle?.tint, colorOf(color?.rgb, fill)),
      opacity: n.circle?.visible === false || n.rendered === false
        ? 0 : opacityOf(n.circle?.alpha, opacityOf(color?.a, 1)),
      labelOpacity: n.text?.visible === false || n.rendered === false
        ? 0 : opacityOf(n.text?.alpha, opacityOf(r.textAlpha, 0)),
      labelSize: clamp(labelSize, 2, 72),
      labelOffset: Math.max(0, labelOffset),
    });
  }
  const links = new Map<string, Connection>();
  for (const edge of r.links) {
    const a = edge?.source?.id, b = edge?.target?.id;
    if (!a || !b || a === b || !nodes.has(a) || !nodes.has(b)) continue;
    const key = edgeKey(a, b);
    const opacity = edge.line?.visible === false || !edge.line
      ? 0 : opacityOf(edge.line.alpha, opacityOf(r.colors?.line?.a, 0.5));
    const existing = links.get(key);
    if (!existing || opacity > existing.opacity) links.set(key, {
      source: a < b ? a : b, target: a < b ? b : a,
      color: colorOf(edge.line?.tint, edgeColor),
      opacity, width: Math.max(0.25, numberOr(r.fLineSizeMult, 1) / dpr), bend: 0,
    });
  }
  return nodes.size ? { frame: { width: r.width, height: r.height, nodes, links, ringOpacity: 0 }, textColor, edgeColor } : null;
}
