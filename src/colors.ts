// Palettes and graph-view group queries. Ported from the prototype CORE.

export type PaletteId = "accent" | "default" | "okabe" | "pastel" | "viridis" | "magma" | "cividis" | "cool" | "warm" | "mono";
interface Palette { name: string; type: "cat" | "seq"; c: string[] }

/** seq: interpolated from hop 0 (focus, brightest) to max hop. cat: one distinct color per hop. */
export const PALETTES: Record<PaletteId, Palette> = {
  // Colors filled in at runtime from the theme accent (accentColors); the purple shades are the fallback.
  accent: { name: "Theme accent", type: "seq", c: ["#e6dcff", "#b9a2ff", "#8c6cf0", "#6142c4", "#3a2580"] },
  default: { name: "Distinct per hop", type: "cat", c: ["#a882ff", "#4fb3ff", "#56d39b", "#f2c14e", "#f08a5d", "#e45f8b", "#9aa0a6", "#7f8c8d", "#6c757d"] },
  okabe: { name: "Okabe-Ito (color-blind safe)", type: "cat", c: ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999"] },
  pastel: { name: "Pastel", type: "cat", c: ["#c3b5ff", "#a8d8ff", "#b2ead0", "#ffe8a8", "#ffc9b0", "#f9b4d0", "#d4d4dc"] },
  viridis: { name: "Viridis", type: "seq", c: ["#fde725", "#7ad151", "#22a884", "#2a788e", "#414487", "#440154"] },
  magma: { name: "Magma", type: "seq", c: ["#fcfdbf", "#fe9f6d", "#de4968", "#8c2981", "#3b0f70"] },
  cividis: { name: "Cividis", type: "seq", c: ["#fee838", "#c3b369", "#8f8a74", "#5f6a75", "#2a4c6b", "#00224e"] },
  cool: { name: "Cool (cyan → violet)", type: "seq", c: ["#6ef0ff", "#5aa9ff", "#7a6cff", "#8a3ffc", "#5b1fa8"] },
  warm: { name: "Warm (yellow → magenta)", type: "seq", c: ["#ffe29a", "#ffb36b", "#ff7a5c", "#e0457b", "#8e2a8e"] },
  mono: { name: "Purple shades", type: "seq", c: ["#e6dcff", "#b9a2ff", "#8c6cf0", "#6142c4", "#3a2580"] },
};

export const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgb2hex = (a: number[]) => "#" + a.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** `accent` replaces the colors of the "accent" palette (from accentColors). */
export function paletteColor(pal: PaletteId, hop: number, maxHop: number, accent?: string[] | null): string {
  const P = PALETTES[pal] || PALETTES.default, c = pal === "accent" && accent ? accent : P.c;
  if (P.type === "cat") return c[Math.min(hop, c.length - 1)];
  const t = Math.min(1, hop / Math.max(1, maxHop)) * (c.length - 1);
  const i = Math.min(Math.floor(t), c.length - 2), f = t - i;
  const a = hex2rgb(c[i]), b = hex2rgb(c[i + 1]);
  return rgb2hex(a.map((v, k) => v + (b[k] - v) * f));
}

/** Light cells get dark text, dark cells get light text. */
export const isLight = (h: string) => {
  const [r, g, b] = hex2rgb(h);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
};

// ---- Theme accent ----

/** "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0.5)" → [1, 2, 3]. */
export function parseCssRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

export function rgb2hsl([r, g, b]: number[]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hsl2hex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb2hex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/**
 * Light-to-dark shades of the theme accent (focus brightest). Lightness and the saturation change follow the
 * fixed "Purple shades" palette, so Obsidian's default accent gives nearly the same colors.
 */
const ACCENT_STOPS: [number, number][] = [[0.93, 1.15], [0.82, 1.15], [0.68, 0.92], [0.51, 0.6], [0.32, 0.62]];
export function accentColors(rgb: number[]): string[] {
  const [h, s] = rgb2hsl(rgb);
  return ACCENT_STOPS.map(([l, k]) => hsl2hex(h, Math.min(1, s * k), l));
}

// ---- Graph view group queries (subset) ----
// Space = AND, OR, - exclude, path: file: tag:, quotes. Bare words match the path only (Obsidian also searches content).
interface Term { neg: boolean; field: string; v: string }
export type Query = Term[][];

export function parseQuery(q: string): Query {
  return q.split(/\s+OR\s+/).map((clause) => {
    const terms: Term[] = [];
    for (const m of clause.matchAll(/(-?)(?:(path|file|tag):)?(?:"([^"]*)"|(\S+))/g)) {
      const v = (m[3] ?? m[4]).toLowerCase();
      if (v) terms.push({ neg: m[1] === "-", field: m[2] || "", v: m[2] === "tag" ? v.replace(/^#/, "") : v });
    }
    return terms;
  }).filter((t) => t.length);
}

export function matchNote(clauses: Query, path: string, tags: string[]) {
  const lp = path.toLowerCase(), name = lp.replace(/^.*\//, "").replace(/\.md$/, "");
  const lt = tags.map((t) => t.toLowerCase().replace(/^#/, ""));
  return clauses.some((terms) => terms.every((t) => {
    const hit = t.field === "path" ? lp.includes(t.v)
      : t.field === "file" ? name.includes(t.v)
      : t.field === "tag" ? lt.some((x) => x === t.v || x.startsWith(t.v + "/"))
      : lp.includes(t.v);
    return hit !== t.neg;
  }));
}

export interface Group { query: string; clauses: Query; color: string }

/** One entry of graph.json `colorGroups` as found on disk (the format is not public, so every field is checked). */
interface RawGroup { query?: unknown; color?: unknown }

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

function groupColor(c: unknown): string {
  if (typeof c === "string") return c;
  const rgb = isObject(c) && typeof c.rgb === "number" ? c.rgb : 0;
  return "#" + (rgb | 0).toString(16).padStart(6, "0");
}

/** Whole graph.json or a bare colorGroups array. color is {rgb: int} or '#hex'. */
export function parseGroups(text: string): Group[] {
  const j: unknown = JSON.parse(text);
  const arr: unknown = Array.isArray(j) ? j : isObject(j) ? j.colorGroups : undefined;
  if (!Array.isArray(arr)) return [];
  const groups: Group[] = [];
  for (const x of arr as RawGroup[]) {
    if (!isObject(x) || typeof x.query !== "string" || !x.query) continue;
    groups.push({ query: x.query, clauses: parseQuery(x.query), color: groupColor(x.color) });
  }
  return groups;
}

/** First matching group from the top (unverified: Obsidian's precedence). */
export function groupOf(groups: Group[], path: string, tags: string[]) {
  for (let i = 0; i < groups.length; i++) if (matchNote(groups[i].clauses, path, tags)) return i;
  return -1;
}

/** Group index of every note (−1 = none). */
export function assignGroups(groups: Group[], paths: string[], tags: string[][]): Int32Array {
  const out = new Int32Array(paths.length).fill(-1);
  if (groups.length) for (let i = 0; i < paths.length; i++) out[i] = groupOf(groups, paths[i], tags[i]);
  return out;
}

export const NO_GROUP_COLOR = "#6b6b73";
