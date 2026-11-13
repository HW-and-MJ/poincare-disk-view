// Screen <-> disk mapping, hit testing and the transforms behind click, drag and animation.
// No Obsidian imports, so Node can test it. Ported from the prototype's input and draw code.
import { abs2, along, fromOrigin, hdist, mApply, mMul, mNorm, toOrigin, type C, type Mobius } from "./geometry.ts";
import type { NodeKey } from "./graph.ts";
import type { Cell } from "./tiling.ts";
import type { PdvSettings } from "./settings.ts";

/** Canvas size in device pixels. */
export interface Frame { w: number; h: number; dpr: number }

/** Disk radius and center in device pixels. */
export const diskOf = (f: Frame) => ({ R: Math.min(f.w, f.h) / 2 - 12 * f.dpr, X: f.w / 2, Y: f.h / 2 });

/** Device-pixel point to disk coordinates, pulled inside |z| ≤ 0.97 so drags near the rim stay stable. */
export function toDisk(px: number, py: number, f: Frame): C {
  const { R, X, Y } = diskOf(f);
  const k = { x: (px - X) / R, y: (py - Y) / R }, l = Math.sqrt(abs2(k));
  return l > 0.97 ? { x: (k.x * 0.97) / l, y: (k.y * 0.97) / l } : k;
}

/** Approximate on-screen radius (device px) of a cell drawn at z. */
export function cellPx(z: C, cells: Cell[] | null, f: Frame) {
  const { R } = diskOf(f), d0 = cells ? Math.sqrt(abs2(cells[0].v[0])) : 0.3;
  return (R * d0 * (1 - abs2(z))) / (1 - d0 * d0);
}

/** Node under the pointer (device px), or null. Cell style: nearest cell center within a cell radius. */
export function hitTest(shown: Map<NodeKey, C>, px: number, py: number, s: PdvSettings, cells: Cell[] | null, f: Frame): NodeKey | null {
  let best: NodeKey | null = null, bd = Infinity;
  const hide2 = s.hide * s.hide;
  // Outside the disk nothing is hit (toDisk would pull the point onto the rim cells).
  const { R, X, Y } = diskOf(f);
  if ((px - X) ** 2 + (py - Y) ** 2 >= R * R) return null;
  if (s.style === "cell" && cells) {
    const p = toDisk(px, py, f), rv = 2 * Math.atanh(Math.sqrt(abs2(cells[0].v[0])));
    for (const [key, z] of shown) {
      if (abs2(z) > hide2) continue;
      const d = hdist(p, z);
      if (d < bd) { bd = d; best = key; }
    }
    return bd <= rv ? best : null;
  }
  for (const [key, z] of shown) {
    if (abs2(z) > hide2) continue;
    const rad = Math.max(1.5 * f.dpr, cellPx(z, cells, f) * s.nodeFill * 0.5) + 4 * f.dpr;
    const d = Math.hypot(X + R * z.x - px, Y + R * z.y - py);
    if (d < rad && d < bd) { bd = d; best = key; }
  }
  return best;
}

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Drag: the disk point under the pointer moves from p0 to p1. */
export const dragTransform = (V: Mobius, p0: C, p1: C): Mobius => mNorm(mMul(mMul(fromOrigin(p1), toOrigin(p0)), V));

/** Focus move: at e = 0 → V0, at e = 1 the point a (as currently drawn) sits at the origin. */
export const moveTransform = (V0: Mobius, a: C, e: number): Mobius => mMul(toOrigin(along(a, e)), V0);

/**
 * Positions to draw: layout positions under V, linearly blended from the previous frame's positions
 * (`from`) while a relayout transition runs (e < 1).
 */
export function blendShown(pos: Map<NodeKey, C>, V: Mobius, from: Map<NodeKey, C> | null, e: number) {
  const shown = new Map<NodeKey, C>();
  for (const [key, z0] of pos) {
    let z = mApply(V, z0);
    const f = from && from.get(key);
    if (f && e < 1) z = { x: f.x + (z.x - f.x) * e, y: f.y + (z.y - f.y) * e };
    shown.set(key, z);
  }
  return shown;
}
