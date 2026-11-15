// Canvas drawing of one frame. No Obsidian imports; the view supplies the scene and theme colors.
// Ported from the prototype's draw() / drawCells(). Coordinates are device pixels.
import {
  abs2, distFromOrigin, fromOrigin, geodesicCircle, mApply, scaleRadial, toOrigin, wrap, type C, type Mobius,
} from "./geometry.ts";
import { isLight } from "./colors.ts";
import { isTreeEdge, type FocusTree, type Graph, type NodeKey, type TreeNode } from "./graph.ts";
import type { Cell } from "./tiling.ts";
import type { PdvSettings } from "./settings.ts";
import { cellPx as cellPxAt, diskOf, warp, warpScale, type Frame, type Unfold } from "./motion.ts";

export interface Theme {
  background: string;
  disk: string;
  border: string;
  text: string;
  font: string;
  /** The graph view's link color (theme). */
  line?: string;
}

export interface Scene {
  g: Graph;
  T: FocusTree;
  /** Cell index of each node in the (unscaled) tiling. */
  cellOf: Map<NodeKey, number>;
  /** Tiling with the cell size multiplier applied. */
  cells: Cell[] | null;
  /** Current view transform (identity until M3 animation). */
  V: Mobius;
  /** Disk position of each node as drawn. */
  shown: Map<NodeKey, C>;
  hover: NodeKey | null;
  /** Fill color per node (see scene.ts colorer). */
  color: (n: TreeNode) => string;
  /** Opacity per node during a transition; 1 when absent. */
  alpha?: (key: NodeKey) => number;
  /** Notes leaving the screen during a transition, drawn as fading dots. */
  ghosts?: { z: C; color: string; alpha: number }[];
  s: PdvSettings;
  /** The graph view's link thickness multiplier (graph.json). */
  lineSize?: number;
}

/**
 * Draw one frame. `unfold` (opening transition) draws the plane with curvature c, zoomed by S around a disk center
 * moved by O; links are drawn straight while the plane is still flattening.
 */
/**
 * "Fade with distance": opacity of a note at disk position z, from the hyperbolic scale factor 1 − |z|². Notes and
 * links far from the focus fade as they shrink: 1 at the center, 1 − amount at the rim.
 */
export const distanceFade = (z: C, amount = 0.85) => 1 - amount + amount * Math.max(0, 1 - abs2(z)) ** 0.6;

/** Fade levels links are grouped into, so they are stroked in a few batches. */
const FADE_LEVELS = 12;

export function drawScene(ctx: CanvasRenderingContext2D, f: Frame, sc: Scene | null, th: Theme, unfold?: Unfold): number {
  const { w, h, dpr } = f;
  const d = diskOf(f);
  const X = d.X + (unfold?.O.x ?? 0), Y = d.Y + (unfold?.O.y ?? 0), R = d.R * (unfold?.S ?? 1);
  const flat = unfold && unfold.c < 0.999 ? unfold : null;
  const scr = flat
    ? (z: C) => { const q = warp(z, flat.c); return { x: X + R * q.x, y: Y + R * q.y }; }
    : (z: C) => ({ x: X + R * z.x, y: Y + R * z.y });
  // A flat plane cannot hold a hyperbolic neighborhood without piling notes up, so while it curves the notes are
  // revealed from the center outward: those within hyperbolic distance 1.2 + 6c, fading over the last unit.
  const reveal = (z: C) => flat ? Math.min(1, Math.max(0, 1.2 + 6 * flat.c - distFromOrigin(z))) : 1;
  /** Labels come in once the plane is close to its final size. */
  const labelAlpha = unfold ? Math.min(1, Math.max(0, (unfold.S - 0.55) / 0.35)) : 1;

  const pathGeo = (u: C, v: C, cont = false) => {
    const su = scr(u), sv = scr(v);
    if (!cont) ctx.moveTo(su.x, su.y);
    if (flat) { ctx.lineTo(sv.x, sv.y); return; }
    const gc = geodesicCircle(u, v);
    if (!gc || gc.r > 50) { ctx.lineTo(sv.x, sv.y); return; }
    const cx = X + R * gc.c.x, cy = Y + R * gc.c.y;
    const a1 = Math.atan2(su.y - cy, su.x - cx), a2 = Math.atan2(sv.y - cy, sv.x - cx);
    ctx.arc(cx, cy, gc.r * R, a1, a2, wrap(a2 - a1) < 0);
  };
  const pathPoly = (vs: C[]) => {
    const s0 = scr(vs[0]);
    ctx.moveTo(s0.x, s0.y);
    for (let k = 0; k < vs.length; k++) pathGeo(vs[k], vs[(k + 1) % vs.length], true);
    ctx.closePath();
  };
  const font = (px: number, bold = false) => `${bold ? "bold " : ""}${px}px ${th.font}`;

  ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  // The rim of a plane with curvature −c lies at radius 1/√c: far outside the canvas while the plane is flat.
  ctx.arc(X, Y, flat ? Math.min(R / Math.sqrt(Math.max(flat.c, 1e-8)), 1e6) : R, 0, 2 * Math.PI);
  // Disk shading off: only the rim, over the plain background like the graph view.
  if (!sc || sc.s.diskShade) {
    ctx.fillStyle = th.disk;
    ctx.fill();
  }
  ctx.strokeStyle = th.border;
  ctx.lineWidth = dpr;
  ctx.stroke();
  if (!sc) return 0;

  const { g, T, s, shown, V, cells, hover } = sc;
  // Links in the graph view's color and thickness (once the view has read its color).
  const graphLine = th.line ?? null, lineWidth = (sc.lineSize ?? 1) * s.linkWidth * dpr;
  const focusKey = T.nodes[0].key;

  if (s.grid && cells) {
    ctx.beginPath();
    for (const cell of cells) {
      const c = mApply(V, cell.c);
      if (abs2(c) > 0.985 || reveal(c) <= 0) continue;
      const vs = cell.v.map((z) => mApply(V, z));
      for (let k = 0; k < vs.length; k++) pathGeo(vs[k], vs[(k + 1) % vs.length]);
    }
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = th.text;
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const vis = (z: C | undefined): z is C => !!z && abs2(z) <= s.hide * s.hide && reveal(z) > 0;
  const cellPx = (z: C) => cellPxAt(z, cells, f) * (unfold?.S ?? 1) * (flat ? warpScale(z, flat.c) : 1);
  const alpha0 = sc.alpha ?? (() => 1);
  const alpha = flat ? (key: NodeKey) => alpha0(key) * reveal(shown.get(key)!) : alpha0;
  const hn = typeof hover === "number" && shown.has(hover) ? g.adj[hover] : null;
  const order = T.nodes
    .filter((n) => vis(shown.get(n.key)))
    .sort((a, b) => abs2(shown.get(b.key)!) - abs2(shown.get(a.key)!)); // edge first, center on top
  const label = (n: TreeNode) => (n.id < 0 ? `+${n.count}` : g.names[n.id]);
  for (const gh of sc.ghosts ?? []) {
    if (!vis(gh.z)) continue;
    const p = scr(gh.z);
    ctx.globalAlpha = gh.alpha * reveal(gh.z);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5 * dpr, cellPx(gh.z) * s.nodeFill * 0.5), 0, 2 * Math.PI);
    ctx.fillStyle = gh.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const fade = (z: C) => (s.fadeFar ? distanceFade(z, s.fadeAmount) : 1);
  /** Stroke links u–v, each at `alpha` times the fade of its fainter end, batched by fade level. */
  const strokeLinks = (pairs: [C, C][], color: string, alpha: number, width: number) => {
    const levels = new Map<number, [C, C][]>();
    for (const pr of pairs) {
      const lv = Math.round(Math.min(fade(pr[0]), fade(pr[1])) * FADE_LEVELS);
      let list = levels.get(lv);
      if (!list) levels.set(lv, list = []);
      list.push(pr);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const [lv, list] of levels) {
      ctx.beginPath();
      for (const [u, v] of list) pathGeo(u, v);
      ctx.globalAlpha = alpha * lv / FADE_LEVELS;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const drawCross = (color: string, alpha = 1) => {
    const pairs: [C, C][] = [];
    for (const n of T.nodes) {
      if (n.id < 0) continue;
      const u = shown.get(n.key);
      if (!vis(u)) continue;
      for (const v of g.adj[n.id].keys()) {
        if (v < n.id) continue;
        const wz = shown.get(v);
        if (vis(wz) && !isTreeEdge(T, n.id, v)) pairs.push([u, wz]);
      }
    }
    strokeLinks(pairs, color, alpha, graphLine ? lineWidth : s.linkWidth * dpr);
  };
  const drawHoverLinks = (color: string, width: number) => {
    if (!hn || typeof hover !== "number") return;
    const u = shown.get(hover)!;
    ctx.beginPath();
    for (const v of hn.keys()) { const wz = shown.get(v); if (vis(wz)) pathGeo(u, wz); }
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.stroke();
  };

  if (s.style === "cell" && cells) {
    // Cell shrunk toward its center by nodeFill (in hyperbolic distance), at its drawn position.
    const cellVerts = (key: NodeKey) => {
      const cell = cells[sc.cellOf.get(key)!], target = mApply(V, cell.c), now = shown.get(key)!;
      const M = toOrigin(target), back = fromOrigin(now);
      return cell.v.map((z) => mApply(back, scaleRadial(mApply(M, mApply(V, z)), s.nodeFill)));
    };
    for (const n of order) {
      ctx.globalAlpha = alpha(n.key) * fade(shown.get(n.key)!);
      ctx.beginPath();
      if (flat) {
        // Keep the cell's shape while the plane is flat: scale it around its drawn center.
        const z = shown.get(n.key)!, p = scr(z), k = R * warpScale(z, flat.c);
        cellVerts(n.key).forEach((v, i) => {
          const x = p.x + k * (v.x - z.x), y = p.y + k * (v.y - z.y);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      } else {
        pathPoly(cellVerts(n.key));
      }
      ctx.fillStyle = sc.color(n);
      ctx.fill();
      const hi = n.key === focusKey || n.key === hover || (hn && typeof n.key === "number" && hn.has(n.key));
      ctx.lineWidth = (hi ? 2.5 : 1.5) * dpr;
      ctx.strokeStyle = hi ? th.text : th.disk;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (s.cross > 0) drawCross(`rgba(20,20,24,${s.cross * 0.8})`);
    drawHoverLinks(th.text, 1.5);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const n of order) {
      const z = shown.get(n.key)!, p = scr(z);
      const cpx = cellPx(z) * s.nodeFill, fs = Math.min(16 * dpr, cpx * 0.32);
      if ((fs < 7 * dpr && n.key !== hover) || labelAlpha === 0) continue;
      const name = label(n), max = Math.max(3, Math.floor((1.7 * cpx) / (fs * 0.6)));
      ctx.font = font(Math.max(fs, 7 * dpr), n.key === focusKey);
      ctx.fillStyle = isLight(sc.color(n)) ? "rgba(15,15,18,0.9)" : "rgba(240,240,245,0.92)";
      ctx.globalAlpha = labelAlpha * alpha(n.key);
      ctx.fillText(name.length > max ? name.slice(0, max - 1) + "…" : name, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    return order.length;
  }

  // Node-edge style
  if (s.cross > 0) {
    if (graphLine) drawCross(graphLine, s.cross);
    else drawCross(`rgba(160,160,170,${s.cross * 0.6})`);
  }
  const tree: [C, C][] = [];
  for (const n of T.nodes) {
    if (!n.parent) continue;
    const u = shown.get(n.key), wz = shown.get(n.parent.key);
    if (vis(u) && vis(wz)) tree.push([wz, u]);
  }
  strokeLinks(tree, graphLine ?? th.text, graphLine ? 1 : 0.55, graphLine ? lineWidth : 1.2 * s.linkWidth * dpr);
  drawHoverLinks(sc.color(T.nodes[0]), 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const n of order) {
    const z = shown.get(n.key)!, k = 1 - abs2(z), p = scr(z);
    const rad = Math.max(1.5 * dpr, cellPx(z) * s.nodeFill * 0.5);
    ctx.globalAlpha = alpha(n.key) * fade(z);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, 2 * Math.PI);
    ctx.fillStyle = sc.color(n);
    ctx.fill();
    if (n.key === focusKey || n.key === hover) { ctx.lineWidth = 2 * dpr; ctx.strokeStyle = th.text; ctx.stroke(); }
    const near = hn && typeof n.key === "number" && hn.has(n.key);
    if ((k >= s.labelMin || n.key === hover || near) && labelAlpha > 0) {
      ctx.font = font((10 + 6 * k) * dpr);
      ctx.fillStyle = th.text;
      ctx.globalAlpha = (0.35 + 0.65 * k) * alpha(n.key) * labelAlpha;
      const name = label(n);
      ctx.fillText(name.length > 26 ? name.slice(0, 25) + "…" : name, p.x, p.y + rad + 2 * dpr);
    }
    ctx.globalAlpha = 1;
  }
  return order.length;
}
