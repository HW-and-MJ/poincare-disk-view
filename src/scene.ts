// From graph + focus + settings to node positions. No Obsidian imports, so Node can test it.
import { scaleRadial, type C } from "./geometry.ts";
import { buildTree, type FocusTree, type Graph, type NodeKey } from "./graph.ts";
import { layoutTiling, makeTiling, scaleTiling, type Cell } from "./tiling.ts";
import type { PdvSettings } from "./settings.ts";
import { NO_GROUP_COLOR, paletteColor, type Group } from "./colors.ts";

/** Tilings are costly to grow, so keep the last base tiling and the last scaled one. */
export class TilingCache {
  private base = { k: "", cells: null as Cell[] | null };
  private scaled = { k: "", cells: null as Cell[] | null };

  get(p: number, q: number) {
    const k = `${p},${q}`;
    if (this.base.k !== k) this.base = { k, cells: makeTiling(p, q) };
    return this.base.cells;
  }

  view(p: number, q: number, lam: number) {
    const k = `${p},${q},${lam}`;
    if (this.scaled.k !== k) {
      const b = this.get(p, q);
      this.scaled = { k, cells: b && scaleTiling(b, lam) };
    }
    return this.scaled.cells;
  }
}

export interface Layout {
  T: FocusTree;
  cellOf: Map<NodeKey, number>;
  /** Positions with the cell size multiplier applied. */
  pos: Map<NodeKey, C>;
  ms: number;
}

export function layoutFocus(g: Graph, focus: number, s: PdvSettings, tc: TilingCache): Layout {
  const t0 = performance.now();
  const T = buildTree(g, focus, s);
  // Cells are assigned on the unscaled tiling so notes stay in the same cell when λ changes.
  const { pos, cellOf } = layoutTiling(T, tc.get(s.p, s.q));
  const scaled = new Map<NodeKey, C>();
  for (const [k, z] of pos) scaled.set(k, scaleRadial(z, s.cellScale));
  return { T, cellOf, pos: scaled, ms: performance.now() - t0 };
}

// ---- Colors ----

export interface ColorContext {
  /** Shades of the theme accent, for the "accent" palette; null before the theme is read. */
  accent: string[] | null;
  groups: Group[];
  /** Group index per note (−1 = none); null until groups are assigned. */
  noteGroup: Int32Array | null;
}

const BUNDLE_COLOR = "#4a4a4f";

/** Fill color of a tree node: by hop with the palette, or by graph view group. */
export function colorer(s: PdvSettings, cc: ColorContext) {
  return (n: { id: number; hop: number }) => {
    if (n.id < 0) return BUNDLE_COLOR;
    if (s.colorMode === "group") {
      const gi = cc.noteGroup ? cc.noteGroup[n.id] : -1;
      return gi >= 0 ? cc.groups[gi].color : NO_GROUP_COLOR;
    }
    return paletteColor(s.palette, n.hop, s.maxHop, cc.accent);
  };
}

export interface LegendItem { color: string; label: string }

/** Legend rows: one per hop, or one per group with note counts (over the whole vault) plus "No group". */
export function legendItems(s: PdvSettings, cc: ColorContext, noteCount: number): LegendItem[] {
  if (s.colorMode === "group") {
    const cnt = new Array(cc.groups.length + 1).fill(0);
    if (cc.noteGroup) for (const x of cc.noteGroup) cnt[x < 0 ? cc.groups.length : x]++;
    else cnt[cc.groups.length] = noteCount;
    return [
      ...cc.groups.map((g, i) => ({ color: g.color, label: `${g.query} (${cnt[i]})` })),
      { color: NO_GROUP_COLOR, label: `No group (${cnt[cc.groups.length]})` },
    ];
  }
  return Array.from({ length: s.maxHop + 1 }, (_, h) => ({
    color: paletteColor(s.palette, h, s.maxHop, cc.accent),
    label: h === 0 ? "Focus" : h === 1 ? "1 hop" : `${h} hops`,
  }));
}
