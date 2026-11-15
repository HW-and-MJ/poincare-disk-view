// The projection design's graph ↔ disk transform (src/projection) applied to the classic disk. The classic drawing
// (exact hyperbolic layout, conformal sizes, geodesic links) is described as a projection Frame, so the projection's
// ProjectionTransition can move the graph view's own nodes onto exactly what the classic disk draws, and back.
// No Obsidian imports, so Node can test it.
import { abs2, type C } from "./geometry.ts";
import { isTreeEdge, type NodeKey } from "./graph.ts";
import { cellPx, diskOf, type Frame } from "./motion.ts";
import { distanceFade, type Scene, type Theme } from "./render.ts";
import type { Circle, Connection, Frame as ProjectionFrame } from "./projection/native-graph.ts";
import { diskBend, drawProjection, type ProjectionTransition } from "./projection/projection.ts";

/** Length of the open and return transforms (ms), as in the projection design. */
export const PROJECT_OPEN_MS = 480;
export const PROJECT_RETURN_MS = 410;

/** Same pairing key as the graph view's links (native-graph.ts), so links carry over. */
const edgeKey = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a]);

/**
 * What drawScene draws in node style, as a projection frame in CSS px: node positions, radii, colors and labels, tree
 * links (and cross links) bent into the same geodesics. Bundles (+N) get their own ids; hidden notes opacity 0.
 */
/** The classic drawing as a projection frame, with the keys of its tree links (the disk's skeleton). */
export interface ClassicFrame extends ProjectionFrame { tree: Set<string> }

export function classicFrame(sc: Scene, f: Frame, th: Theme): ClassicFrame {
  const { R, X, Y } = diskOf(f), px = 1 / f.dpr, s = sc.s, hide2 = s.hide * s.hide;
  const nodes = new Map<string, Circle>(), links = new Map<string, Connection>(), tree = new Set<string>();
  const idOf = new Map<NodeKey, string>(), zOf = new Map<string, C>();
  for (const n of sc.T.nodes) {
    const z = sc.shown.get(n.key);
    if (!z) continue;
    const id = n.id >= 0 ? sc.g.paths[n.id] : "\0bundle:" + String(n.key);
    idOf.set(n.key, id);
    zOf.set(id, z);
    const k = 1 - abs2(z), visible = abs2(z) <= hide2;
    const rad = Math.max(1.5 * f.dpr, cellPx(z, sc.cells, f) * s.nodeFill * 0.5);
    const name = n.id < 0 ? `+${n.count}` : sc.g.names[n.id];
    nodes.set(id, {
      id, label: name.length > 26 ? name.slice(0, 25) + "…" : name,
      x: (X + R * z.x) * px, y: (Y + R * z.y) * px, radius: rad * px,
      color: sc.color(n), opacity: visible ? (s.fadeFar ? distanceFade(z, s.fadeAmount) : 1) : 0,
      labelOpacity: visible && k >= s.labelMin ? 0.35 + 0.65 * k : 0,
      labelSize: 10 + 6 * k, labelOffset: rad * px + 2, hop: n.hop,
      ...(n.id < 0 ? { bundle: n.count } : {}),
    });
  }
  const link = (a: string, b: string, color: string, opacity: number, width: number) => {
    const [source, target] = a < b ? [a, b] : [b, a];
    const bend = diskBend(zOf.get(source)!, zOf.get(target)!);
    links.set(edgeKey(a, b), { source, target, color, opacity, width, bend });
  };
  const visible = (id: string) => nodes.get(id)!.opacity > 0;
  /** A link's opacity factor: the fade of its fainter end, quantized like drawScene's batches. */
  const fadeOf = (a: string, b: string) => s.fadeFar
    ? Math.round(Math.min(distanceFade(zOf.get(a)!, s.fadeAmount), distanceFade(zOf.get(b)!, s.fadeAmount)) * 12) / 12 : 1;
  // Same link look as drawScene: the graph view's color and thickness.
  const line = th.line ?? null, lineWidth = (sc.lineSize ?? 1) * s.linkWidth;
  for (const n of sc.T.nodes) {
    if (!n.parent) continue;
    const a = idOf.get(n.parent.key), b = idOf.get(n.key);
    if (!a || !b) continue;
    tree.add(edgeKey(a, b));
    link(a, b, line ?? th.text, visible(a) && visible(b) ? (line ? 1 : 0.55) * fadeOf(a, b) : 0, line ? lineWidth : 1.2 * s.linkWidth);
  }
  if (s.cross > 0) {
    for (const n of sc.T.nodes) {
      if (n.id < 0) continue;
      for (const v of sc.g.adj[n.id].keys()) {
        if (v < n.id || isTreeEdge(sc.T, n.id, v)) continue;
        const a = idOf.get(n.key), b = idOf.get(v);
        if (a && b) link(a, b, line ?? "#a0a0aa", visible(a) && visible(b) ? (line ? s.cross : s.cross * 0.6) * fadeOf(a, b) : 0, line ? lineWidth : s.linkWidth);
      }
    }
  }
  return { width: f.w * px, height: f.h * px, nodes, links, ringOpacity: 0, tree };
}

/**
 * The disk frame to start a return from: links the graph view also draws take its link color, since a transition
 * keeps each link's starting color and the return must end exactly on the graph's drawing. The change is hidden
 * under the finished disk drawing that fades out over the start of the return.
 */
export function returnStart(disk: ClassicFrame, graph: ProjectionFrame): ClassicFrame {
  const links = new Map<string, Connection>();
  for (const [key, l] of disk.links) {
    const g = graph.links.get(key);
    links.set(key, g ? { ...l, color: g.color } : l);
  }
  return { ...disk, links };
}

/** A node is seen in a frame when it is drawn (opacity) on or near the canvas. */
function seen(n: Circle, frame: ProjectionFrame) {
  const m = n.radius + 24;
  return n.opacity > 0.02 && n.x > -m && n.y > -m && n.x < frame.width + m && n.y < frame.height + m;
}

/**
 * Split the transform into what moves and what stays. Moving: the notes the disk shows and its tree links, each
 * from where the graph view draws it. Staying: everything else the graph view shows (notes the disk does not show,
 * links outside the tree), drawn once as a still image that fades out while the disk forms (or fades in at the
 * end of a return). The disk's cross links appear with the finished drawing. So only about as many items move as
 * the disk shows, however dense the graph is.
 */
export function splitForMorph(graph: ProjectionFrame, disk: ClassicFrame) {
  const onDisk = new Set<string>();
  for (const n of disk.nodes.values()) if (seen(n, disk)) onDisk.add(n.id);
  const pick = (frame: ProjectionFrame, ids: (id: string) => boolean, keys: (key: string) => boolean): ProjectionFrame => ({
    ...frame,
    nodes: new Map([...frame.nodes].filter(([id]) => ids(id))),
    links: new Map([...frame.links].filter(([key, l]) => keys(key) && l.opacity > 0.02)),
  });
  const moves = (key: string) => disk.tree.has(key);
  const bothMove = (key: string, l: Connection) => moves(key) && onDisk.has(l.source) && onDisk.has(l.target);
  const movingKeys = new Set([...disk.links].filter(([key, l]) => bothMove(key, l)).map(([key]) => key));
  return {
    graph: pick(graph, (id) => onDisk.has(id), (key) => movingKeys.has(key)),
    disk: pick(disk, (id) => onDisk.has(id), (key) => movingKeys.has(key)),
    /** Seen in the graph view but not moving. */
    still: pick(graph, (id) => !onDisk.has(id) && seen(graph.nodes.get(id)!, graph), (key) => !movingKeys.has(key)),
  };
}

/** Share of the transform spent crossfading with the finished disk drawing. */
const SETTLE = 0.15;

const smooth = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/**
 * One frame of the transform at t ∈ [0, 1]: the projection's moving nodes over the classic disk background, which
 * fades in (or out when returning). `finished` draws the classic disk; it is laid over the end of an opening (and
 * the start of a return), where the projection frame and the classic drawing coincide, so nothing jumps.
 */
export function drawClassicMorph(
  ctx: CanvasRenderingContext2D, f: Frame, th: Theme, move: ProjectionTransition, t: number, reverse: boolean,
  edgeColor: string, still: CanvasImageSource | null,
  /** A cleared canvas at CSS size (frame size / dpr). */ layer: () => CanvasRenderingContext2D, finished: () => CanvasImageSource, shade = true,
) {
  const { R, X, Y } = diskOf(f), e = smooth(t), disk = reverse ? 1 - e : e;
  ctx.globalAlpha = 1;
  ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, f.w, f.h);
  if (disk > 0.01) { // the rim fades in; with disk shading, the fill too
    ctx.globalAlpha = disk;
    ctx.beginPath();
    ctx.arc(X, Y, R, 0, 2 * Math.PI);
    if (shade) {
      ctx.fillStyle = th.disk;
      ctx.fill();
    }
    ctx.strokeStyle = th.border;
    ctx.lineWidth = f.dpr;
    ctx.stroke();
  }
  // Nodes move during the first 85% (opening) or last 85% (return); the finished drawing crossfades in the rest,
  // while both drawings have every note in the same place.
  const p = reverse ? Math.max(0, (t - SETTLE) / (1 - SETTLE)) : Math.min(1, t / (1 - SETTLE));
  // Moving nodes are drawn at CSS resolution (as the projection design does while moving) and scaled up.
  // What does not move fades out over the first 35% of the movement (in over the last 35% when returning).
  const stillAlpha = reverse ? smooth((p - 0.65) / 0.35) : 1 - smooth(p / 0.35);
  if (still && stillAlpha > 0.01) {
    ctx.globalAlpha = stillAlpha;
    ctx.drawImage(still, 0, 0, f.w, f.h);
  }
  const frame = move.at(p), l = layer();
  l.setTransform(1, 0, 0, 1, 0, 0);
  drawProjection(l, frame, th.text, edgeColor, th.font);
  ctx.globalAlpha = 1;
  ctx.drawImage(l.canvas, 0, 0, f.w, f.h);
  const over = reverse ? 1 - smooth(t / SETTLE) : smooth((t - (1 - SETTLE)) / SETTLE);
  if (over > 0.01) {
    ctx.globalAlpha = over;
    ctx.drawImage(finished(), 0, 0);
  }
  ctx.globalAlpha = 1;
}
