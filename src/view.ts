import { Component, ItemView, Scope, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type PoincareDiskPlugin from "./main";
import { abs2, M_ID, type C, type Mobius } from "./geometry.ts";
import { noteName, type Graph, type NodeKey } from "./graph.ts";
import { bestRotation, blendShown, diskOf, dragTransform, ease, hitTest, moveTransform, rotation, toDisk, unfoldAt, type Frame, type Unfold } from "./motion.ts";
import { buildPanel } from "./panel.ts";
import { drawScene, type Theme } from "./render.ts";
import { colorer, layoutFocus, legendItems, TilingCache, type ColorContext, type Layout } from "./scene.ts";
import { accentColors, hex2rgb, parseCssRgb, rgb2hex } from "./colors.ts";
import type { Frame as GraphFrame, NativeSnapshot } from "./projection/native-graph.ts";
import { drawProjection, ProjectionTransition } from "./projection/projection.ts";
import { classicFrame, drawClassicMorph, PROJECT_OPEN_MS, PROJECT_RETURN_MS, returnStart, splitForMorph } from "./classic-morph.ts";

export const VIEW_TYPE = "poincare-disk-view";

/** #rrggbb between a (t = 0) and b (t = 1). */
const mixHex = (a: string, b: string, t: number) => {
  const p = hex2rgb(a), q = hex2rgb(b);
  return rgb2hex(p.map((v, i) => v + (q[i] - v) * t));
};

type Anim =
  | { type: "move"; V0: Mobius; a: C; t0: number; dur: number }
  | { type: "blend"; from: Map<NodeKey, C>; colors: Map<NodeKey, string>; t0: number; dur: number }
  /** Opening transition. t0 < 0: starts at the first frame drawn (a new tab may not have its size yet). */
  | { type: "unfold"; point?: C; start?: C; t0: number; dur: number }
  /**
   * Morph between the graph view's drawing and this disk (classic-morph.ts): its nodes slide, grow or shrink onto
   * the disk, or back onto `graph` when `reverse`. Built at the first frame; `done` runs when it ends.
   */
  | { type: "project"; graph: GraphFrame; edgeColor: string; reverse: boolean; move?: ProjectionTransition; still?: CanvasImageSource | null; t0: number; dur: number; done?: () => void };

/** Length of the opening transition (ms). */
export const UNFOLD_MS = 900;

/** Two clicks within this time and distance count as a double-click. */
const DBL_MS = 400, DBL_PX = 6, DRAG_PX = 4;

/**
 * View state. `path`: the centered note. `back`: the tab was switched here from the graph view, so Esc navigates back to
 * it. `unfold` / `unfoldFrom` (client px) play the opening transition once; they are not
 * returned by getState, so navigating back and forward does not replay it.
 */
export interface DiskState { path?: string; back?: boolean; unfold?: boolean; unfoldFrom?: C }

export class PoincareDiskView extends ItemView {
  disk!: PoincareDisk;
  /** Record moves to and from this view in the tab's history (back / forward). */
  navigation = true;
  private back = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: PoincareDiskPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Poincaré disk view"; }
  getIcon() { return "circle-dot"; }

  async onOpen() {
    this.disk = this.addChild(new PoincareDisk(this.contentEl, this.plugin));
    this.disk.resetFocus(this.plugin.initialFocus());
    this.scope = new Scope(this.app.scope);
    this.scope.register([], "Escape", () => {
      if (!this.back) return true; // not handled: let Obsidian use Esc as usual
      this.goBack();
      return false;
    });
  }

  getState(): Record<string, unknown> {
    const state: DiskState = { back: this.back };
    if (this.disk?.focusPath) state.path = this.disk.focusPath;
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult) {
    const st = (state ?? {}) as DiskState;
    this.back = st.back === true;
    this.disk.backHint = this.back;
    if (typeof st.path === "string") this.disk.resetFocus(st.path, { allowOrphan: true });
    if (st.unfold) this.disk.enterFrom(st.unfoldFrom);
    await super.setState(state, result);
  }

  /** Same as the back button: return to the graph this tab showed before. */
  private goBack() {
    const app = this.app as unknown as { commands?: { executeCommandById?: (id: string) => boolean } };
    if (app.commands?.executeCommandById?.("app:go-back")) return;
    void this.leaf.setViewState({ type: "graph", active: true });
  }

  async onClose() {
    this.removeChild(this.disk);
  }
}

export class PoincareDisk extends Component {
  private canvas!: HTMLCanvasElement;
  private statsEl!: HTMLElement;
  private tipEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private legendEl!: HTMLElement;
  private legendKey = "";
  /** Shades of the theme accent for the "accent" palette. */
  private accent: string[] | null = null;
  /** The graph view's node color (theme), for notes in no group. */
  private noGroup?: string;
  /** The graph view's link color (theme). */
  private lineColor?: string;
  /** Text color resolved to #rrggbb, for link contrast. */
  private textColor?: string;
  private tilings = new TilingCache();
  private layout: Layout | null = null;
  private needsLayout = false;
  /** View transform from drag and focus-move animation. */
  private V: Mobius = M_ID;
  /** Rotation chosen at the last relayout; "Re-center" returns here. */
  private baseV: Mobius = M_ID;
  private anim: Anim | null = null;
  /** Positions drawn in the last frame. */
  private shown = new Map<NodeKey, C>();
  private hover: NodeKey | null = null;
  private press: { x: number; y: number; p: C; drag: boolean } | null = null;
  private lastClick: { key: number; x: number; y: number; t: number } | null = null;
  private frame = 0;
  /** Offscreen layers for the morph: the moving graph nodes and the finished disk drawing. */
  private layers: HTMLCanvasElement[] = [];
  focusPath: string | null = null;
  /** This disk replaced the graph view in its tab: say how to return. */
  backHint = false;
  /** A note chosen through a file menu may stay centered even if it has no links. */
  private allowOrphanFocus = false;
  /** One-line message under the stats, e.g. why the opened note did not become the focus. */
  private notice: string | null = null;

  constructor(
    private readonly contentEl: HTMLElement,
    private readonly plugin: PoincareDiskPlugin,
  ) {
    super();
  }

  private get win() { return this.contentEl.win; }

  onload() {
    const root = this.contentEl;
    root.empty();
    root.addClass("pdv-root");
    this.canvas = root.createEl("canvas", { cls: "pdv-canvas" });
    this.statsEl = root.createDiv({ cls: "pdv-stats" });
    this.tipEl = root.createDiv({ cls: "pdv-tip" });
    this.legendEl = root.createDiv({ cls: "pdv-legend" });
    this.readAccent();

    const controls = root.createDiv({ cls: "pdv-controls" });
    const button = (icon: string, label: string, onClick: () => void) => {
      const b = controls.createDiv({ cls: "clickable-icon pdv-button", attr: { "aria-label": label } });
      setIcon(b, icon);
      this.registerDomEvent(b, "click", onClick);
      return b;
    };
    button("search", "Find a note to put at the center", () => this.plugin.openSearch(this));
    button("locate-fixed", "Re-center", () => { this.V = this.baseV; this.anim = null; this.requestDraw(); });
    const gear = button("settings", "Settings", () => {
      const open = !this.panelEl.hasClass("is-open");
      this.panelEl.toggleClass("is-open", open);
      gear.toggleClass("is-active", open);
      if (open) buildPanel(this.panelEl, this.plugin);
    });
    this.panelEl = root.createDiv({ cls: "pdv-panel" });

    this.registerDomEvent(this.canvas, "pointerdown", (ev) => this.onPointerDown(ev));
    this.registerDomEvent(this.canvas, "pointermove", (ev) => this.onPointerMove(ev));
    this.registerDomEvent(this.canvas, "pointerup", (ev) => this.onPointerUp(ev));
    this.registerDomEvent(this.canvas, "pointercancel", () => {
      this.press = this.lastClick = null;
      this.canvas.removeClass("is-dragging");
    });
    this.registerDomEvent(this.canvas, "pointerleave", () => this.setHover(null));
    this.registerEvent(this.plugin.app.workspace.on("css-change", () => { this.readAccent(); this.requestDraw(); }));
    // This also redraws a hidden disk when its container becomes visible again.
    const resize = new ResizeObserver(() => this.requestDraw());
    resize.observe(root);
    this.register(() => resize.disconnect());
  }

  onunload() {
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  // ---- focus ----

  /** Move the focus to a note, animated when it is on screen. Orphans (by default) leave the focus where it is. */
  setFocus(path: string | null) {
    if (!path || path === this.focusPath) return;
    if (!this.plugin.canFocus(path)) {
      this.notice = `Not shown, the note has no links: ${noteName(path)}`;
      this.requestDraw();
      return;
    }
    this.notice = null;
    this.focusPath = path;
    this.allowOrphanFocus = false;
    const idx = this.plugin.graph?.index.get(path), z = idx === undefined ? undefined : this.shown.get(idx);
    const hide = this.plugin.settings.hide;
    if (this.layout && z && abs2(z) <= hide * hide) {
      this.anim = { type: "move", V0: this.V, a: z, t0: this.win.performance.now(), dur: 450 };
      this.requestDraw();
    } else {
      this.relayout(true);
    }
  }

  canKeepFocus() {
    return this.focusPath !== null && this.plugin.canFocus(this.focusPath, this.allowOrphanFocus);
  }

  /** Set the focus and put it at the center immediately. */
  resetFocus(path: string | null, { allowOrphan = false } = {}) {
    this.focusPath = path;
    this.allowOrphanFocus = allowOrphan;
    this.notice = null;
    this.V = this.baseV = M_ID;
    this.anim = null;
    this.relayout();
  }

  /**
   * Play the opening transition: the neighborhood starts as a small flat plane at `point` (client px, e.g. where a
   * graph note was right-clicked; the center when absent), grows and curves into the disk. Skipped when the "Opening animation" setting is off or with reduced motion.
   */
  enterFrom(point?: C) {
    if (!this.plugin.settings.openAnimation || this.win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.anim = { type: "unfold", point, t0: -1, dur: UNFOLD_MS };
    this.setHover(null);
    this.requestDraw();
  }

  private get unfolding() { return this.anim?.type === "unfold" || this.anim?.type === "project"; }

  /** Opened over the graph view: its nodes move onto this disk. */
  morphFrom(snapshot: NativeSnapshot) {
    this.anim = { type: "project", graph: snapshot.frame, edgeColor: snapshot.edgeColor, reverse: false, t0: -1, dur: PROJECT_OPEN_MS };
    this.setHover(null);
    this.requestDraw();
  }

  /** Move every note back to where the graph view draws it now, then `done`. */
  morphBack(graph: GraphFrame, edgeColor: string, done: () => void) {
    this.anim = { type: "project", graph, edgeColor, reverse: true, t0: -1, dur: PROJECT_RETURN_MS, done };
    this.press = null;
    this.setHover(null);
    this.requestDraw();
  }

  /**
   * The plugin rebuilt the graph; node keys are graph indices and may have shifted. Carry what is on screen over
   * by note path, then blend into the new layout.
   */
  graphChanged(oldG: Graph, newG: Graph) {
    const remap = (k: NodeKey): NodeKey | undefined => {
      if (typeof k === "number") return newG.index.get(oldG.paths[k]);
      const id = newG.index.get(oldG.paths[Number(k.slice(3))]);
      return id === undefined ? undefined : "agg" + id;
    };
    const shown = new Map<NodeKey, C>();
    for (const [k, z] of this.shown) { const nk = remap(k); if (nk !== undefined) shown.set(nk, z); }
    this.shown = shown;
    this.hover = null;
    this.layout = null; // old keys are meaningless now; relayout blends from `shown`
    this.relayout(true, true);
  }

  private visible() { return this.contentEl.clientWidth > 0 && this.contentEl.clientHeight > 0; }

  /**
   * Recompute positions. With transition, positions blend from what is on screen into the new layout, rotated to
   * match it as closely as possible; without it (settings changed), the current drag offset is kept.
   * A hidden view only marks the layout stale.
   */
  relayout(transition = false, fromShown = false) {
    if (!transition || !this.visible()) {
      this.needsLayout = true;
      if (transition) { this.anim = null; this.V = this.baseV = M_ID; }
      this.requestDraw();
      return;
    }
    const from = this.layout || fromShown ? new Map(this.shown) : null;
    const colors = new Map<NodeKey, string>();
    if (from && this.layout) {
      const color = colorer(this.plugin.settings, this.colorContext());
      for (const n of this.layout.T.nodes) colors.set(n.key, color(n));
    }
    this.computeLayout();
    this.V = this.baseV = from && this.layout ? rotation(bestRotation(this.layout.pos, from)) : M_ID;
    this.anim = from ? { type: "blend", from, colors, t0: this.win.performance.now(), dur: 550 } : null;
    this.requestDraw();
  }

  private computeLayout() {
    this.needsLayout = false;
    const g = this.plugin.graph, idx = this.focusPath ? g?.index.get(this.focusPath) : undefined;
    this.layout = g && idx !== undefined ? layoutFocus(g, idx, this.plugin.settings, this.tilings) : null;
    if (this.hover !== null && !this.layout?.pos.has(this.hover)) this.hover = null;
  }

  // ---- input ----

  private devicePoint(ev: PointerEvent) {
    const r = this.canvas.getBoundingClientRect(), dpr = this.win.devicePixelRatio || 1;
    return { px: (ev.clientX - r.left) * dpr, py: (ev.clientY - r.top) * dpr };
  }

  private frameSize(): Frame {
    const dpr = this.win.devicePixelRatio || 1;
    return { w: Math.round(this.contentEl.clientWidth * dpr), h: Math.round(this.contentEl.clientHeight * dpr), dpr };
  }

  private hit(ev: PointerEvent): NodeKey | null {
    const s = this.plugin.settings, { px, py } = this.devicePoint(ev);
    return hitTest(this.shown, px, py, this.drawSettings(), this.tilings.view(s.p, s.q, s.cellScale), this.frameSize());
  }

  private onPointerDown(ev: PointerEvent) {
    if (ev.button !== 0 || this.unfolding) return;
    const { px, py } = this.devicePoint(ev);
    this.press = { x: ev.clientX, y: ev.clientY, p: toDisk(px, py, this.frameSize()), drag: false };
    this.canvas.setPointerCapture(ev.pointerId);
  }

  private onPointerMove(ev: PointerEvent) {
    const press = this.press;
    if (press) {
      if (!press.drag && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > DRAG_PX) {
        press.drag = true;
        this.setHover(null);
        this.canvas.addClass("is-dragging");
        // A drag cuts a running focus move short: jump to the new layout.
        if (this.anim?.type === "move") { this.anim = null; this.V = this.baseV = M_ID; this.computeLayout(); }
      }
      if (press.drag) {
        const { px, py } = this.devicePoint(ev), p1 = toDisk(px, py, this.frameSize());
        this.V = dragTransform(this.V, press.p, p1);
        press.p = p1;
        this.requestDraw();
      }
      return;
    }
    if (!this.unfolding) this.setHover(this.hit(ev), ev);
  }

  private onPointerUp(ev: PointerEvent) {
    const press = this.press;
    this.press = null;
    this.canvas.removeClass("is-dragging");
    if (!press || press.drag || Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > DRAG_PX) return;
    const now = this.win.performance.now(), last = this.lastClick;
    if (last && now - last.t < DBL_MS && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < DBL_PX) {
      // The note may have moved under the pointer since the first click; open the one clicked first.
      this.lastClick = null;
      const path = this.plugin.graph?.paths[last.key];
      if (path) void this.plugin.openNote(path, ev.metaKey || ev.ctrlKey);
      return;
    }
    const h = this.hit(ev);
    if (typeof h !== "number") { this.lastClick = null; return; }
    this.lastClick = { key: h, x: ev.clientX, y: ev.clientY, t: now };
    const path = this.plugin.graph?.paths[h];
    if (path) this.setFocus(path);
  }

  private setHover(h: NodeKey | null, ev?: PointerEvent) {
    if (h !== this.hover) { this.hover = h; this.requestDraw(); }
    const g = this.plugin.graph, n = h === null ? undefined : this.layout?.T.byKey.get(h);
    if (!g || !n || !ev) { this.tipEl.removeClass("is-visible"); return; }
    const links = g.adj[Math.max(n.id, 0)].size;
    this.tipEl.setText(n.id < 0
      ? `${n.count} notes bundled (max children)`
      : `${g.names[n.id]}\n${n.hop === 1 ? "1 hop" : `${n.hop} hops`} · ${links} ${links === 1 ? "link" : "links"}\n${g.paths[n.id]}` +
        (g.tags[n.id].length ? `\n${g.tags[n.id].join(" ")}` : ""));
    const r = this.contentEl.getBoundingClientRect();
    this.tipEl.style.left = `${ev.clientX - r.left + 14}px`;
    this.tipEl.style.top = `${ev.clientY - r.top + 14}px`;
    this.tipEl.addClass("is-visible");
  }

  // ---- drawing ----

  requestDraw() {
    if (this.frame) return;
    this.frame = this.win.requestAnimationFrame((now) => { this.frame = 0; this.draw(now); });
  }

  /** Theme accent → palette shades. The variable may hold calc() text, so let the browser resolve it to rgb(). */
  private readAccent() {
    const probe = this.contentEl.createDiv({ cls: "pdv-accent-probe" });
    const rgb = parseCssRgb(this.win.getComputedStyle(probe).color);
    probe.remove();
    this.accent = rgb ? accentColors(rgb) : null;
    // The graph view takes its node color from an element with these classes (theme variable --graph-node).
    const node = this.contentEl.createDiv({ cls: "graph-view color-fill pdv-graph-probe" });
    const fill = parseCssRgb(this.win.getComputedStyle(node).color);
    node.remove();
    this.noGroup = fill ? rgb2hex(fill) : undefined;
    const lineProbe = this.contentEl.createDiv({ cls: "graph-view color-line pdv-graph-probe" });
    const line = parseCssRgb(this.win.getComputedStyle(lineProbe).color);
    lineProbe.remove();
    this.lineColor = line ? rgb2hex(line) : undefined;
    const textProbe = this.contentEl.createDiv({ cls: "pdv-text-probe" });
    const text = parseCssRgb(this.win.getComputedStyle(textProbe).color);
    textProbe.remove();
    this.textColor = text ? rgb2hex(text) : undefined;
  }

  private colorContext(): ColorContext {
    return {
      accent: this.accent, groups: this.plugin.groups, noteGroup: this.plugin.noteGroup, noGroup: this.noGroup,
      dark: this.contentEl.doc.body.hasClass("theme-dark"),
    };
  }

  private showLegend(cc: ColorContext) {
    const g = this.plugin.graph, s = this.plugin.settings;
    const items = g && s.showLegend ? legendItems(s, cc, g.names.length) : [];
    const key = JSON.stringify(items);
    if (key === this.legendKey) return;
    this.legendKey = key;
    this.legendEl.empty();
    this.legendEl.toggleClass("is-visible", items.length > 0);
    for (const it of items) {
      const row = this.legendEl.createDiv({ cls: "pdv-legend-row" });
      row.createSpan({ cls: "pdv-legend-swatch" }).style.background = it.color;
      row.createSpan({ text: it.label });
    }
  }

  private theme(): Theme {
    const css = this.win.getComputedStyle(this.contentEl);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
      background: v("--background-primary", "#1e1e1e"),
      disk: v("--background-secondary", "#161616"),
      border: v("--background-modifier-border", "#444"),
      text: v("--text-normal", "#ddd"),
      font: v("--font-interface", "sans-serif"),
      line: this.lineColor && this.textColor
        ? mixHex(this.lineColor, this.textColor, this.plugin.settings.linkContrast) : this.lineColor,
    };
  }

  private draw(now: number) {
    const c = this.canvas;
    if (!c) return;
    const f = this.frameSize();
    if (f.w === 0 || f.h === 0) return;
    if (c.width !== f.w) c.width = f.w;
    if (c.height !== f.h) c.height = f.h;
    if (this.needsLayout) this.computeLayout();

    let from: Map<NodeKey, C> | null = null, colors: Map<NodeKey, string> | null = null, e = 1;
    let unfold: Unfold | undefined, projectT: number | undefined;
    const anim = this.anim;
    if (anim) {
      if (anim.type === "unfold" && anim.t0 < 0) {
        anim.t0 = now;
        anim.start = this.unfoldStart(anim.point, f);
      }
      if (anim.type === "project" && anim.t0 < 0) anim.t0 = now;
      const t = Math.min(1, (now - anim.t0) / anim.dur), k = ease(t);
      if (anim.type === "unfold") {
        if (t < 1) unfold = unfoldAt(t, anim.start ?? { x: 0, y: 0 });
      } else if (anim.type === "project") {
        if (t < 1) projectT = t;
        else if (anim.reverse) { this.anim = null; anim.done?.(); return; } // keep the last frame: the graph's own
      } else if (anim.type === "move") {
        this.V = moveTransform(anim.V0, anim.a, k);
        if (t >= 1 && this.layout) {
          this.shown = blendShown(this.layout.pos, this.V, null, 1).shown;
          this.relayout(true); // starts the blend into the new layout
          return;
        }
      } else {
        from = anim.from;
        colors = anim.colors;
        e = k;
      }
      if (t >= 1) this.anim = null;
    }

    const g = this.plugin.graph, L = this.layout, s = this.plugin.settings;
    const blended = L ? blendShown(L.pos, this.V, from, e) : null;
    this.shown = blended ? blended.shown : new Map<NodeKey, C>();
    const cc = this.colorContext(), alpha = blended?.alpha;
    const ghosts = [];
    if (from && L) for (const [k, z] of from) if (!L.pos.has(k)) ghosts.push({ z, color: colors?.get(k) ?? "#888", alpha: 1 - e });
    const ds = this.drawSettings();
    const scene = g && L ? {
      g, T: L.T, cellOf: L.cellOf, cells: this.tilings.view(s.p, s.q, s.cellScale),
      V: this.V, shown: this.shown, hover: this.hover, s: ds, color: colorer(s, cc),
      lineSize: this.plugin.graphDisplay.lineSize,
      alpha: alpha && alpha.size ? (key: NodeKey) => alpha.get(key) ?? 1 : undefined,
      ghosts,
    } : null;
    const ctx = c.getContext("2d")!, th = this.theme();
    let nVis: number;
    const project = this.anim?.type === "project" ? this.anim : null;
    if (project && projectT !== undefined && scene) {
      if (!project.move) {
        // The disk as it is drawn now is the other end of the morph.
        const full = classicFrame(scene, f, th);
        const disk = project.reverse ? returnStart(full, project.graph) : full;
        // Only the disk's notes and tree links move; the rest of the graph is one still image (classic-morph.ts).
        const parts = splitForMorph(project.graph, disk);
        project.move = project.reverse ? new ProjectionTransition(parts.disk, parts.graph) : new ProjectionTransition(parts.graph, parts.disk);
        const css = { w: Math.round(f.w / f.dpr), h: Math.round(f.h / f.dpr), dpr: 1 };
        const still = this.layer(2, css);
        drawProjection(still, parts.still, th.text, project.edgeColor, th.font);
        project.still = still.canvas;
      }
      let drawn = 0;
      drawClassicMorph(ctx, f, th, project.move, projectT, project.reverse, project.edgeColor, project.still ?? null,
        () => this.layer(0, { w: Math.round(f.w / f.dpr), h: Math.round(f.h / f.dpr), dpr: 1 }),
        () => { const l = this.layer(1, f); drawn = drawScene(l, f, scene, th); return l.canvas; }, ds.diskShade);
      nVis = drawn || scene.T.nodes.length;
    } else {
      if (project && !scene) { this.anim = null; project.done?.(); } // nothing to morph
      nVis = drawScene(ctx, f, scene, th, unfold);
    }
    this.showStats(nVis);
    this.showLegend(cc);
    if (this.anim) this.requestDraw();
  }

  /** Settings as drawn: node sizes follow the graph view's node size multiplier. */
  private drawSettings() {
    const s = this.plugin.settings;
    return { ...s, nodeFill: s.nodeFill * this.plugin.graphDisplay.nodeSize };
  }

  /** Offscreen layer i at the canvas size, cleared. */
  private layer(i: number, f: Frame): CanvasRenderingContext2D {
    const el = this.layers[i] ??= this.win.document.createElement("canvas");
    if (el.width !== f.w) el.width = f.w;
    if (el.height !== f.h) el.height = f.h;
    const l = el.getContext("2d")!;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, f.w, f.h);
    return l;
  }

  /** Offset (device px) of a client point from the disk center, or the center itself. */
  private unfoldStart(point: C | undefined, f: Frame): C {
    if (!point) return { x: 0, y: 0 };
    const { left, top } = this.canvas.getBoundingClientRect(), { X, Y } = diskOf(f);
    return { x: (point.x - left) * f.dpr - X, y: (point.y - top) * f.dpr - Y };
  }

  private showStats(nVis: number) {
    const g = this.plugin.graph, L = this.layout, s = this.plugin.settings;
    let text: string;
    if (!g) text = "Reading links…";
    else if (!L) text = this.focusPath ? `Note not in the graph: ${this.focusPath}` : "No notes";
    else {
      const f = L.T.nodes[0].id;
      text = `${g.names[f]} · ${g.adj[f].size} links · ${L.T.reached} within ${s.maxHop} hops · ${nVis} shown` +
        ` · ${g.names.length} notes · ${L.ms.toFixed(0)} ms`;
    }
    if (this.notice) text += "\n" + this.notice;
    if (this.backHint) text += "\nBack (←) or Esc returns to the graph";
    if (this.statsEl.getText() !== text) this.statsEl.setText(text);
  }
}
