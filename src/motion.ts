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

/** Rotation of the disk by θ about the center, as a Möbius map: f(z) = e^{iθ} z. */
export const rotation = (th: number): Mobius => ({ a: { x: Math.cos(th / 2), y: Math.sin(th / 2) }, b: { x: 0, y: 0 } });

/**
 * The rotation of a new layout that best matches where its notes are drawn now (least squares over the notes in both,
 * weighted toward the center). A relayout grows the tiling in a fixed orientation, so without this every note
 * would swing around the disk.
 */
export function bestRotation(pos: Map<NodeKey, C>, from: Map<NodeKey, C>): number {
  let sx = 0, sy = 0;
  for (const [key, f] of from) {
    const z = pos.get(key);
    if (!z) continue;
    const w = Math.max(0, 1 - abs2(f));
    sx += w * (z.x * f.x + z.y * f.y);
    sy += w * (z.x * f.y - z.y * f.x);
  }
  return sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx);
}

/** Point at fraction t along the hyperbolic geodesic from f to z. */
export function geoLerp(f: C, z: C, t: number): C {
  const p = mApply(toOrigin(f), z);
  return mApply(fromOrigin(f), along(p, t));
}

/** Notes that would travel farther than this (hyperbolic distance) fade out and back in instead of flying across. */
export const FAR = 2.5;

/**
 * Positions and opacities to draw. Layout positions are taken under V. While a relayout transition runs (e < 1),
 * notes on screen before move from their old position along a geodesic; notes that would travel farther than FAR
 * fade out in place and fade in at the new place; new notes fade in.
 */
export function blendShown(pos: Map<NodeKey, C>, V: Mobius, from: Map<NodeKey, C> | null, e: number) {
  const shown = new Map<NodeKey, C>(), alpha = new Map<NodeKey, number>();
  for (const [key, z0] of pos) {
    let z = mApply(V, z0), a = 1;
    const f = from && e < 1 ? from.get(key) : undefined;
    if (f) {
      if (hdist(f, z) > FAR) {
        if (e < 0.5) { z = f; a = 1 - 2 * e; } else a = 2 * e - 1;
      } else {
        z = geoLerp(f, z, e);
      }
    } else if (from && e < 1) {
      a = e;
    }
    shown.set(key, z);
    if (a < 1) alpha.set(key, a);
  }
  return { shown, alpha };
}
