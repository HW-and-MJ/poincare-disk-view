// Settings and their defaults (the prototype's current defaults). The settings panel comes in M3-M4.
import type { PaletteId } from "./colors.ts";

export interface PdvSettings {
  /** Cell fill or node-edge (OPD-D05). */
  style: "cell" | "node";
  colorMode: "hop" | "group";
  palette: PaletteId;
  /** Tiling {p,q}, one of TILING_PRESETS. */
  p: number;
  q: number;
  /** Draw the tiling grid behind the notes. */
  grid: boolean;
  /** Notes with disk radius |z| above this are hidden. */
  hide: number;
  maxHop: number;
  hub: number;
  maxKids: number;
  /** Cell size multiplier λ. */
  cellScale: number;
  /** Node size as a fraction of its cell. */
  nodeFill: number;
  /** Node-edge labels shown when 1 − |z|² is at least this. */
  labelMin: number;
  /** Cross-link opacity. */
  cross: number;
  showLegend: boolean;
  /** Move the focus to the note opened in the editor. */
  followActive: boolean;
  /** Allow notes without any links to become the focus (like the graph view's "Orphans"). */
  showOrphans: boolean;
  /** Play the unfolding transition when a note is opened from a file menu or the graph view. */
  openAnimation: boolean;
  /** Fill the disk with a shade of gray (off: only its rim, over the plain background like the graph view). */
  diskShade: boolean;
  /** Notes and links farther from the focus are drawn fainter. */
  fadeFar: boolean;
  /** How much "Fade with distance" fades: opacity at the rim is 1 − this. */
  fadeAmount: number;
  /** Link width multiplier. */
  linkWidth: number;
  /** Links: 0 = the graph view's link color, 1 = the text color. */
  linkContrast: number;
}

export const DEFAULT_SETTINGS: PdvSettings = {
  style: "node",
  colorMode: "group",
  palette: "accent",
  p: 7,
  q: 3,
  grid: false,
  hide: 0.975,
  maxHop: 6,
  hub: 1,
  maxKids: 90,
  cellScale: 1,
  nodeFill: 0.35,
  labelMin: 0.25,
  cross: 0.06,
  showLegend: true,
  followActive: true,
  showOrphans: false,
  openAnimation: true,
  diskShade: false,
  fadeFar: true,
  fadeAmount: 0.55,
  linkWidth: 1.4,
  linkContrast: 0.15,
};

// ---- Panel layout (labels and ranges from the prototype) ----
type NumKey = { [K in keyof PdvSettings]: PdvSettings[K] extends number ? K : never }[keyof PdvSettings];
type BoolKey = { [K in keyof PdvSettings]: PdvSettings[K] extends boolean ? K : never }[keyof PdvSettings];

export interface SliderSpec { key: NumKey; label: string; min: number; max: number; step: number; desc?: string }
export interface ToggleSpec { key: BoolKey; label: string; desc?: string }

export const LAYOUT_SLIDERS: SliderSpec[] = [
  { key: "maxHop", label: "Max hops", min: 1, max: 10, step: 1 },
  { key: "hub", label: "Hub penalty", min: 0, max: 3, step: 0.1, desc: "Paths through heavily linked notes count as longer" },
  { key: "maxKids", label: "Max children", min: 2, max: 120, step: 1, desc: "Extra children are bundled into one +N cell" },
  { key: "hide", label: "Hide radius", min: 0.8, max: 0.995, step: 0.005, desc: "Notes farther out than this disk radius are hidden" },
];
export const SIZE_SLIDERS: SliderSpec[] = [
  { key: "cellScale", label: "Cell size", min: 0.4, max: 2, step: 0.05 },
  { key: "nodeFill", label: "Node size", min: 0.1, max: 1, step: 0.05, desc: "Fraction of its cell" },
  { key: "labelMin", label: "Label threshold", min: 0.05, max: 1, step: 0.05, desc: "Node-edge style: names shown where 1 − |z|² is at least this" },
  { key: "cross", label: "Cross-link opacity", min: 0, max: 1, step: 0.01 },
  { key: "fadeAmount", label: "Fade amount", min: 0, max: 1, step: 0.05, desc: "Fade with distance: 0 none, 1 notes at the rim nearly vanish" },
  { key: "linkWidth", label: "Link thickness", min: 0.5, max: 3, step: 0.1 },
  { key: "linkContrast", label: "Link contrast", min: 0, max: 1, step: 0.05, desc: "Graph view link color (0) to text color (1)" },
];
export const TOGGLES: ToggleSpec[] = [
  { key: "grid", label: "Tiling grid" },
  { key: "diskShade", label: "Disk shading", desc: "Fill the disk with a gray shade" },
  { key: "fadeFar", label: "Fade with distance", desc: "Notes and links farther from the center are fainter" },
  { key: "showLegend", label: "Legend" },
  { key: "followActive", label: "Follow active note", desc: "Move the focus to the note opened in the editor" },
  { key: "showOrphans", label: "Show orphans", desc: "Notes without links can become the focus" },
  { key: "openAnimation", label: "Opening animation", desc: "Unfold the disk from the note when opening it from the graph view or a file menu" },
];
export const TILING_LABELS: Record<string, string> = {
  "7,3": "{7,3} heptagons · 7 in ring 1",
  "8,3": "{8,3} octagons · 8 in ring 1",
  "5,4": "{5,4} pentagons · 5 in ring 1",
  "6,4": "{6,4} hexagons · 6 in ring 1",
  "4,5": "{4,5} squares · 4 in ring 1",
  "4,6": "{4,6} squares · 4 in ring 1, larger cells",
  "3,7": "{3,7} triangles · 3 in ring 1",
};
