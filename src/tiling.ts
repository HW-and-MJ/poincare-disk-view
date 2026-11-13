// Regular hyperbolic tiling {p,q} and placing tree nodes into its cells.
import { abs2, hdist, reflect, scaleRadial, ZERO, type C } from "./geometry.ts";
import type { FocusTree, NodeKey } from "./graph.ts";

export interface Cell {
  c: C;
  v: C[];
  /** Indices of the cells sharing an edge with this one (incomplete at the generated rim). */
  n: number[];
}

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
  const cells: Cell[] = [{ c: ZERO, v: verts, n: [] }];
  const seen = new Map([[key(ZERO), 0]]);
  const link = (i: number, j: number) => {
    if (!cells[i].n.includes(j)) cells[i].n.push(j);
    if (!cells[j].n.includes(i)) cells[j].n.push(i);
  };
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (abs2(cell.c) > 0.995 ** 2) continue;
    for (let k = 0; k < p; k++) {
      const a = cell.v[k], b = cell.v[(k + 1) % p], c = reflect(cell.c, a, b), kk = key(c);
      const j = seen.get(kk);
      if (j !== undefined) { link(i, j); continue; }
      if (cells.length >= maxCells) continue;
      seen.set(kk, cells.length);
      cells.push({ c, v: cell.v.map((z) => reflect(z, a, b)), n: [] });
      link(i, cells.length - 1);
    }
  }
  return cells;
}

/** Cell size multiplier: scales every vertex's distance from the focus, so neighbors still share vertices. */
export const scaleTiling = (cells: Cell[], lam: number): Cell[] =>
  cells.map((c) => ({ c: scaleRadial(c.c, lam), v: c.v.map((z) => scaleRadial(z, lam)), n: c.n }));

export interface Placement { pos: Map<NodeKey, C>; cellOf: Map<NodeKey, number> }

/** Cost of putting a child in cell c when its parent sits at pp: distance, plus a penalty for moving inward. */
const placeCost = (c: C, pp: C, rp: number) => hdist(c, pp) + (abs2(c) < rp ? 2 : 0);

/** How many cell layers past the first free cell are still searched (the inward penalty can make a farther cell win). */
export const SEARCH_LAYERS = 2;

/**
 * In distance order, put each node in the free cell nearest its parent, preferring cells farther out.
 * The search walks the cell adjacency outward from the parent's cell instead of scanning every cell;
 * `exhaustive` scans every cell (the original method, kept for comparison in tests).
 */
export function layoutTiling(T: FocusTree, cells: Cell[] | null, exhaustive = false): Placement {
  const root = T.nodes[0].key;
  const pos = new Map<NodeKey, C>([[root, ZERO]]);
  const cellOf = new Map<NodeKey, number>([[root, 0]]);
  if (!cells) return { pos, cellOf };
  const used = new Uint8Array(cells.length);
  used[0] = 1;
  const seen = new Int32Array(cells.length);
  let stamp = 0;
  for (const n of T.nodes.slice(1).sort((a, b) => a.d - b.d)) {
    const pc = n.parent ? cellOf.get(n.parent.key) : undefined;
    if (pc === undefined) continue;
    const pp = cells[pc].c, rp = abs2(pp);
    let best = -1, bc = Infinity;
    const consider = (i: number) => {
      if (used[i]) return;
      const cost = placeCost(cells[i].c, pp, rp);
      if (cost < bc) { bc = cost; best = i; }
    };
    if (exhaustive) {
      for (let i = 1; i < cells.length; i++) consider(i);
    } else {
      stamp++;
      seen[pc] = stamp;
      let frontier = [pc], layer = 0, foundAt = -1;
      while (frontier.length && (foundAt < 0 || layer <= foundAt + SEARCH_LAYERS)) {
        const next: number[] = [];
        for (const i of frontier) {
          consider(i);
          for (const j of cells[i].n) if (seen[j] !== stamp) { seen[j] = stamp; next.push(j); }
        }
        if (best >= 0 && foundAt < 0) foundAt = layer;
        frontier = next;
        layer++;
      }
    }
    if (best < 0) break;
    used[best] = 1;
    pos.set(n.key, cells[best].c);
    cellOf.set(n.key, best);
  }
  return { pos, cellOf };
}
