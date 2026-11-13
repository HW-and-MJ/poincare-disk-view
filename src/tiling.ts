// Regular hyperbolic tiling {p,q} and placing tree nodes into its cells.
import { abs2, hdist, reflect, scaleRadial, ZERO, type C } from "./geometry.ts";
import type { FocusTree, NodeKey } from "./graph.ts";

export interface Cell { c: C; v: C[] }

/** {p,q} pairs offered in the UI; all are hyperbolic. */
export const TILING_PRESETS: readonly [number, number][] = [[7, 3], [8, 3], [5, 4], [6, 4], [4, 5], [4, 6], [3, 7]];

/** Grows the tiling from the central polygon by reflecting across edges. null for non-hyperbolic {p,q}. */
export function makeTiling(p: number, q: number, maxCells = 2500): Cell[] | null {
  if ((p - 2) * (q - 2) <= 4) return null;
  // Center-to-vertex distance R: cosh R = cot(π/p)·cot(π/q); in disk coordinates tanh(R/2).
  const d0 = Math.tanh(Math.acosh(1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q))) / 2);
  const verts = Array.from({ length: p }, (_, k) => ({
    x: d0 * Math.cos((2 * Math.PI * k) / p),
    y: d0 * Math.sin((2 * Math.PI * k) / p),
  }));
  const key = (z: C) => (Math.round(z.x * 1e5) + 0) + "," + (Math.round(z.y * 1e5) + 0); // +0 merges -0 and 0
  const cells: Cell[] = [{ c: ZERO, v: verts }];
  const seen = new Set([key(ZERO)]);
  for (let i = 0; i < cells.length && cells.length < maxCells; i++) {
    const cell = cells[i];
    if (abs2(cell.c) > 0.995 ** 2) continue;
    for (let k = 0; k < p && cells.length < maxCells; k++) {
      const a = cell.v[k], b = cell.v[(k + 1) % p], c = reflect(cell.c, a, b), kk = key(c);
      if (seen.has(kk)) continue;
      seen.add(kk);
      cells.push({ c, v: cell.v.map((z) => reflect(z, a, b)) });
    }
  }
  return cells;
}

/** Cell size multiplier: scales every vertex's distance from the focus, so neighbors still share vertices. */
export const scaleTiling = (cells: Cell[], lam: number): Cell[] =>
  cells.map((c) => ({ c: scaleRadial(c.c, lam), v: c.v.map((z) => scaleRadial(z, lam)) }));

export interface Placement { pos: Map<NodeKey, C>; cellOf: Map<NodeKey, number> }

/** In distance order, put each node in the free cell nearest its parent, preferring cells farther out. */
export function layoutTiling(T: FocusTree, cells: Cell[] | null): Placement {
  const root = T.nodes[0].key;
  const pos = new Map<NodeKey, C>([[root, ZERO]]);
  const cellOf = new Map<NodeKey, number>([[root, 0]]);
  if (!cells) return { pos, cellOf };
  const used = new Uint8Array(cells.length);
  used[0] = 1;
  for (const n of T.nodes.slice(1).sort((a, b) => a.d - b.d)) {
    const pp = n.parent && pos.get(n.parent.key);
    if (!pp) continue;
    const rp = abs2(pp);
    let best = -1, bc = Infinity;
    for (let i = 1; i < cells.length; i++) {
      if (used[i]) continue;
      const c = cells[i].c, cost = hdist(c, pp) + (abs2(c) < rp ? 2 : 0);
      if (cost < bc) { bc = cost; best = i; }
    }
    if (best < 0) break;
    used[best] = 1;
    pos.set(n.key, cells[best].c);
    cellOf.set(n.key, best);
  }
  return { pos, cellOf };
}
