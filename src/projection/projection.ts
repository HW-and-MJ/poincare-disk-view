import { abs2, fromOrigin, geodesicCircle, mApply, scaleRadial, toOrigin, M_ID, type C, type Mobius } from "../geometry.ts";
import { graphFromLinks, isTreeEdge } from "../graph.ts";
import { bestRotation } from "../motion.ts";
import { layoutFocus, TilingCache } from "../scene.ts";
import { DEFAULT_SETTINGS as DEFAULTS, type PdvSettings as Preferences } from "../settings.ts";
import { clamp, type Circle, type Connection, type Frame } from "./native-graph.ts";

type NodeColor = (id: string, hop: number, original: string) => string;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ring = (frame: Frame) => ({
  x: frame.width / 2, y: frame.height / 2,
  radius: Math.max(1, Math.min(frame.width, frame.height) * 0.46),
});

export function warmTiles(cache: TilingCache, prefs: Preferences = DEFAULTS) {
  cache.get(prefs.p, prefs.q);
}

/** Convert the circle orthogonal to the unit circle to its signed arc height. */
export function diskBend(a: C, b: C) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const sideLength = Math.hypot(dx, dy);
  if (sideLength < 1e-6) return 0;
  const circle = geodesicCircle(a, b);
  if (!circle) return 0;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const side = ((circle.c.y - my) * dx - (circle.c.x - mx) * dy) / sideLength;
  return -Math.sign(side) * (sideLength / 2) / (circle.r + Math.abs(side));
}

export class Projection {
  private readonly graph;
  // Plain fields rather than constructor parameter properties, so Node's type stripping can run the tests.
  private readonly original: Frame;
  private readonly tiles: TilingCache;

  constructor(original: Frame, tiles: TilingCache) {
    this.original = original;
    this.tiles = tiles;
    const links = Object.create(null) as Record<string, Record<string, number>>;
    const tags = Object.create(null) as Record<string, string[]>;
    for (const id of original.nodes.keys()) {
      tags[id] = [];
      links[id] = Object.create(null) as Record<string, number>;
    }
    for (const { source, target } of original.links.values()) links[source][target] = 1;
    this.graph = graphFromLinks(links, tags);
  }

  has(id: string) { return this.graph.index.has(id); }

  center(id: string, prefs: Preferences = DEFAULTS, color: NodeColor = (_id, _hop, original) => original): Frame | null {
    const focus = this.graph.index.get(id);
    const anchor = this.original.nodes.get(id);
    if (focus === undefined || !anchor) return null;

    const { x, y, radius } = ring(this.original);
    const layout = layoutFocus(this.graph, focus, prefs, this.tiles);
    const directions = new Map<number, C>();
    for (const [index] of this.graph.adj[focus]) {
      const native = this.original.nodes.get(this.graph.paths[index])!;
      const dx = native.x - anchor.x, dy = native.y - anchor.y;
      const divisor = Math.max(radius, Math.hypot(dx, dy));
      directions.set(index, { x: dx / divisor, y: dy / divisor });
    }
    const angle = bestRotation(layout.pos, directions);
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotate = (z: C) => ({ x: z.x * c - z.y * s, y: z.x * s + z.y * c });
    const tiles = this.tiles.view(prefs.p, prefs.q, prefs.cellScale);
    const tileOf = (key: number | string) => {
      if (prefs.style !== "cell") return undefined;
      const cell = tiles?.[layout.cellOf.get(key) ?? -1];
      if (!cell) return undefined;
      const outward = fromOrigin(cell.c), inward = toOrigin(cell.c);
      return cell.v.map(z => rotate(mApply(outward, scaleRadial(mApply(inward, z), prefs.nodeFill))));
    };
    const geometry = new Map<string, C>();
    const nodes = new Map<string, Circle>();
    for (const native of this.original.nodes.values()) {
      const index = this.graph.index.get(native.id)!;
      const inner = layout.pos.get(index);
      const direction = Math.atan2(native.y - anchor.y, native.x - anchor.x);
      const outer = Math.hypot(native.x - anchor.x, native.y - anchor.y);
      const rim = 0.94 + 0.043 * outer / (radius + outer);
      const factor = inner ? Math.min(1, 0.988 / Math.hypot(inner.x, inner.y)) : 1;
      const z = inner
        ? { x: factor * (inner.x * c - inner.y * s), y: factor * (inner.x * s + inner.y * c) }
        : { x: rim * Math.cos(direction), y: rim * Math.sin(direction) };
      geometry.set(native.id, z);

      const falloff = Math.max(0, 1 - z.x * z.x - z.y * z.y);
      const base = clamp(native.radius, 3, 10);
      const size = clamp(base * (0.23 + 1.65 * falloff ** 1.8) * (prefs.nodeFill / DEFAULTS.nodeFill), 0.6, 26);
      const hop = layout.T.hop[index];
      const label = native.id === id || (!!inner && falloff >= prefs.labelMin);
      const tile = tileOf(index);
      const bundled = !inner && hop >= 0;
      const visible = (!bundled && (prefs.showOrphans || this.graph.adj[index].size > 0)) || native.id === id;
      nodes.set(native.id, {
        ...native, x: x + radius * z.x, y: y + radius * z.y, radius: size,
        color: color(native.id, hop >= 0 ? hop : prefs.maxHop, native.color),
        hop, tile, tileOpacity: tile ? 1 : 0,
        opacity: !visible ? 0 : native.id === id ? 1 : 0.21 + 0.72 * falloff ** 0.6,
        labelOpacity: label && visible ? 0.65 + 0.35 * falloff : 0,
        labelSize: native.id === id ? 15 : 12,
        labelOffset: size + 3,
      });
    }

    const links = new Map<string, Connection>();
    for (const treeNode of layout.T.nodes) {
      if (treeNode.id >= 0 || !treeNode.parent) continue;
      const point = layout.pos.get(treeNode.key);
      if (!point) continue;
      const bundle = "\\0bundle:" + this.graph.paths[treeNode.parent.id];
      const z = rotate(point), tile = tileOf(treeNode.key);
      nodes.set(bundle, {
        id: bundle, label: "+" + treeNode.count, x: x + radius * z.x, y: y + radius * z.y,
        radius: 6 * prefs.nodeFill, color: "#6c6c77", opacity: 0.82, labelOpacity: 1,
        labelSize: 11, labelOffset: 8, bundle: treeNode.count, hop: treeNode.hop, tile, tileOpacity: tile ? 1 : 0,
      });
      geometry.set(bundle, z);
      const parent = this.graph.paths[treeNode.parent.id];
      links.set(bundle, { source: parent, target: bundle, color: "#777777", opacity: 0.3, width: 0.8,
        bend: diskBend(geometry.get(parent)!, z) });
    }
    for (const [key, edge] of this.original.links) {
      const a = geometry.get(edge.source)!, b = geometry.get(edge.target)!;
      const fa = 1 - a.x * a.x - a.y * a.y, fb = 1 - b.x * b.x - b.y * b.y;
      const ai = this.graph.index.get(edge.source)!, bi = this.graph.index.get(edge.target)!;
      const emphasis = isTreeEdge(layout.T, ai, bi) ? 1 : Math.min(1, prefs.cross / DEFAULTS.cross);
      links.set(key, {
        ...edge, bend: diskBend(a, b),
        opacity: nodes.get(edge.source)!.opacity && nodes.get(edge.target)!.opacity
          ? (0.04 + 0.55 * Math.min(fa, fb) ** 0.68) * emphasis : 0,
        width: clamp(edge.width, 0.5, 1.4),
      });
    }

    const grid = prefs.grid && tiles
      ? tiles.filter(cell => abs2(cell.c) <= 0.95).map(cell => cell.v.map(rotate)) : undefined;
    return { width: this.original.width, height: this.original.height, nodes, links, ringOpacity: 0.23,
      grid, gridOpacity: grid ? 0.22 : 0 };
  }
}

export function moveDisk(frame: Frame, view: Mobius, hide: number): Frame {
  const { x, y, radius } = ring(frame), limit = hide * hide;
  const nodes = new Map<string, Circle>(), points = new Map<string, C>();
  for (const n of frame.nodes.values()) {
    const a = { x: (n.x - x) / radius, y: (n.y - y) / radius };
    const b = view === M_ID ? a : mApply(view, a);
    const k = abs2(b);
    points.set(n.id, b);
    const scale = clamp((1 - k) / Math.max(0.001, 1 - abs2(a)), 0.12, 10);
    const visible = k <= limit;
    nodes.set(n.id, {
      ...n, x: x + radius * b.x, y: y + radius * b.y,
      radius: clamp(n.radius * scale, 0.45, 28), labelOffset: n.labelOffset * scale,
      opacity: visible ? n.opacity : 0, labelOpacity: visible ? n.labelOpacity : 0,
      tile: n.tile && view !== M_ID ? n.tile.map(z => mApply(view, z)) : n.tile,
    });
  }
  const links = new Map<string, Connection>();
  for (const [id, link] of frame.links) {
    const a = points.get(link.source)!, b = points.get(link.target)!;
    links.set(id, {
      ...link, bend: view === M_ID ? link.bend : diskBend(a, b),
      opacity: nodes.get(link.source)?.opacity && nodes.get(link.target)?.opacity ? link.opacity : 0,
    });
  }
  const grid = frame.grid && view !== M_ID ? frame.grid.map(cell => cell.map(z => mApply(view, z))) : frame.grid;
  return { ...frame, nodes, links, grid };
}

type Pair<T> = { start: T; end: T; current: T };

function paired<T>(a: Map<string, T>, b: Map<string, T>, invisible: (value: T) => T) {
  const pairs: Pair<T>[] = [];
  const visible = new Map<string, T>();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const first = a.get(key), last = b.get(key);
    const start = first ?? invisible(last!);
    const end = last ?? invisible(first!);
    const current = { ...start };
    pairs.push({ start, end, current });
    visible.set(key, current);
  }
  return { pairs, visible };
}

/** Keep one circle per note identity while moving position, size, and link curvature. */
export class ProjectionTransition {
  readonly frame: Frame;
  private readonly nodes: Pair<Circle>[];
  private readonly edges: Pair<Connection>[];

  private readonly from: Frame;
  private readonly to: Frame;

  constructor(from: Frame, to: Frame) {
    this.from = from;
    this.to = to;
    const nodes = paired(from.nodes, to.nodes, n => ({ ...n, opacity: 0, labelOpacity: 0, radius: 0.3, tileOpacity: 0 }));
    const edges = paired(from.links, to.links, e => ({ ...e, opacity: 0 }));
    this.nodes = nodes.pairs;
    this.edges = edges.pairs;
    this.frame = { width: to.width, height: to.height, nodes: nodes.visible, links: edges.visible,
      ringOpacity: from.ringOpacity, grid: to.grid ?? from.grid, gridOpacity: from.gridOpacity };
  }

  at(progress: number) {
    const t = progress * progress * (3 - 2 * progress);
    this.frame.ringOpacity = lerp(this.from.ringOpacity, this.to.ringOpacity, t);
    this.frame.gridOpacity = lerp(this.from.gridOpacity ?? 0, this.to.gridOpacity ?? 0, t);
    for (const { start, end, current } of this.nodes) {
      current.x = lerp(start.x, end.x, t);
      current.y = lerp(start.y, end.y, t);
      current.radius = start.radius * (end.radius / start.radius) ** t;
      current.opacity = lerp(start.opacity, end.opacity, t);
      current.labelOpacity = lerp(start.labelOpacity, end.labelOpacity, t);
      current.labelSize = lerp(start.labelSize, end.labelSize, t);
      current.labelOffset = lerp(start.labelOffset, end.labelOffset, t);
      current.tile = end.tile ?? start.tile;
      current.tileOpacity = lerp(start.tileOpacity ?? 0, end.tileOpacity ?? 0, t);
      current.color = t < 0.55 ? start.color : end.color;
      current.hop = end.hop ?? start.hop;
    }
    for (const { start, end, current } of this.edges) {
      current.bend = lerp(start.bend, end.bend, t);
      current.opacity = lerp(start.opacity, end.opacity, t);
      current.width = lerp(start.width, end.width, t);
    }
    return this.frame;
  }
}

function arc(path: Path2D, a: C, b: C, bend: number, connected = false) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const half = Math.hypot(dx, dy) / 2;
  if (!connected) path.moveTo(a.x, a.y);
  if (Math.abs(half * bend) < 0.22 || half < 0.2) {
    path.lineTo(b.x, b.y);
    return;
  }
  const normal = (bend * bend - 1) / (4 * bend);
  const x = (a.x + b.x) / 2 - dy * normal, y = (a.y + b.y) / 2 + dx * normal;
  path.arc(x, y, Math.hypot(a.x - x, a.y - y),
    Math.atan2(a.y - y, a.x - x), Math.atan2(b.y - y, b.x - x), bend > 0);
}

interface Paint {
  path: Path2D;
  color: string;
  alpha: number;
  width: number;
}

function paintFor(cache: Map<string, Paint>, color: string, opacity: number, width = 1) {
  const alpha = Math.round(opacity * 24) / 24;
  const pixels = Math.round(width * 4) / 4;
  const key = color + "/" + alpha + "/" + pixels;
  let paint = cache.get(key);
  if (!paint) {
    paint = { path: new Path2D(), color, alpha, width: pixels };
    cache.set(key, paint);
  }
  return paint.path;
}

/** A temporary canvas uses the graph's theme and draws circles and arcs together. */
export function drawProjection(ctx: CanvasRenderingContext2D, frame: Frame, textColor: string,
  edgeColor: string, font: string, hover?: string) {
  ctx.clearRect(0, 0, frame.width, frame.height);
  if (frame.ringOpacity > 0.01) {
    const { x, y, radius } = ring(frame);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = edgeColor;
    ctx.globalAlpha = frame.ringOpacity;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const { x, y, radius } = ring(frame);
  const pixel = (z: C) => ({ x: x + radius * z.x, y: y + radius * z.y });
  const polygon = (path: Path2D, points: C[]) => {
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      arc(path, pixel(a), pixel(b), diskBend(a, b), i > 0);
    }
    path.closePath();
  };
  if (frame.grid && (frame.gridOpacity ?? 0) > 0.01) {
    const grid = new Path2D();
    for (const cell of frame.grid) polygon(grid, cell);
    ctx.globalAlpha = frame.gridOpacity!;
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 0.65;
    ctx.stroke(grid);
  }

  const edges = new Map<string, Paint>();
  for (const edge of frame.links.values()) {
    if (edge.opacity < 0.021) continue;
    const a = frame.nodes.get(edge.source), b = frame.nodes.get(edge.target);
    if (!a || !b) continue;
    if (!edge.bend && ((a.x < 0 && b.x < 0) || (a.y < 0 && b.y < 0) ||
      (a.x > frame.width && b.x > frame.width) || (a.y > frame.height && b.y > frame.height))) continue;
    const highlighted = !!hover && (edge.source === hover || edge.target === hover);
    arc(paintFor(edges, highlighted ? textColor : edge.color, highlighted ? 0.72 : edge.opacity,
      highlighted ? 1.75 : edge.width), a, b, edge.bend);
  }
  for (const { path, color, alpha, width } of edges.values()) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }

  const circles = new Map<string, Paint>();
  const labels: Circle[] = [];
  for (const n of frame.nodes.values()) {
    if (n.x < -n.radius || n.x > frame.width + n.radius || n.y < -n.radius || n.y > frame.height + n.radius) continue;
    const tile = n.tileOpacity ?? 0;
    if (n.tile && tile * n.opacity >= 0.022) {
      polygon(paintFor(circles, n.color, tile * n.opacity), n.tile);
    }
    const dotOpacity = n.opacity * (1 - tile);
    if (dotOpacity >= 0.021) {
      const path = paintFor(circles, n.color, dotOpacity);
      path.moveTo(n.x + n.radius, n.y);
      path.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);
    }
    if ((n.labelOpacity >= 0.04 && n.labelSize >= 5) || n.id === hover) labels.push(n);
  }
  for (const { path, color, alpha } of circles.values()) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = textColor;
  for (const n of labels) {
    ctx.globalAlpha = n.id === hover ? 1 : n.labelOpacity;
    ctx.font = Math.max(n.id === hover ? 11 : 2, n.labelSize) + "px " + font;
    ctx.fillText(n.label, n.x, n.y + n.labelOffset);
  }
  ctx.globalAlpha = 1;
}
