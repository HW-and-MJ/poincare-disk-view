import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type PoincareDiskPlugin from "./main";
import { abs2, M_ID, type C, type Mobius } from "./geometry.ts";
import { noteName, type Graph, type NodeKey } from "./graph.ts";
import { bestRotation, blendShown, dragTransform, ease, hitTest, moveTransform, rotation, toDisk, type Frame } from "./motion.ts";
import { buildPanel } from "./panel.ts";
import { drawScene, type Theme } from "./render.ts";
import { colorer, layoutFocus, legendItems, TilingCache, type ColorContext, type Layout } from "./scene.ts";
import { accentColors, parseCssRgb } from "./colors.ts";

export const VIEW_TYPE = "poincare-disk-view";

type Anim =
  | { type: "move"; V0: Mobius; a: C; t0: number; dur: number }
  | { type: "blend"; from: Map<NodeKey, C>; colors: Map<NodeKey, string>; t0: number; dur: number };

/** Two clicks within this time and distance count as a double-click. */
const DBL_MS = 400, DBL_PX = 6, DRAG_PX = 4;

export class PoincareDiskView extends ItemView {
  private plugin: PoincareDiskPlugin;
  private canvas!: HTMLCanvasElement;
  private statsEl!: HTMLElement;
  private tipEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private legendEl!: HTMLElement;
  private legendKey = "";
  /** Shades of the theme accent for the "accent" palette. */
  private accent: string[] | null = null;
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
  focusPath: string | null = null;
  /** One-line message under the stats, e.g. why the opened note did not become the focus. */
  private notice: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PoincareDiskPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Poincaré disk view"; }
  getIcon() { return "circle-dot"; }

  async onOpen() {
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
    this.registerDomEvent(this.canvas, "pointerleave", () => this.setHover(null));
    this.registerEvent(this.app.workspace.on("css-change", () => { this.readAccent(); this.requestDraw(); }));
    // A hidden view postpones layout work; draw (and catch up) when it is shown again.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.requestDraw()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.requestDraw()));
    this.resetFocus(this.plugin.initialFocus());
  }

  async onClose() {
    if (this.frame) window.cancelAnimationFrame(this.frame);
  }

  onResize() { this.requestDraw(); }

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
    const idx = this.plugin.graph?.index.get(path), z = idx === undefined ? undefined : this.shown.get(idx);
    const hide = this.plugin.settings.hide;
    if (this.layout && z && abs2(z) <= hide * hide) {
      this.anim = { type: "move", V0: this.V, a: z, t0: performance.now(), dur: 450 };
      this.requestDraw();
    } else {
      this.relayout(true);
    }
  }

  /** Set the focus without animation or checks (graph rebuilt, view opened). */
  resetFocus(path: string | null) {
    this.focusPath = path;
    this.notice = null;
    this.V = this.baseV = M_ID;
    this.anim = null;
    this.relayout();
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
    this.anim = from ? { type: "blend", from, colors, t0: performance.now(), dur: 550 } : null;
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
    const r = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    return { px: (ev.clientX - r.left) * dpr, py: (ev.clientY - r.top) * dpr };
  }

  private frameSize(): Frame {
    const dpr = window.devicePixelRatio || 1;
    return { w: Math.round(this.contentEl.clientWidth * dpr), h: Math.round(this.contentEl.clientHeight * dpr), dpr };
  }

  private hit(ev: PointerEvent): NodeKey | null {
    const s = this.plugin.settings, { px, py } = this.devicePoint(ev);
    return hitTest(this.shown, px, py, s, this.tilings.view(s.p, s.q, s.cellScale), this.frameSize());
  }

  private onPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
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
    this.setHover(this.hit(ev), ev);
  }

  private onPointerUp(ev: PointerEvent) {
    const press = this.press;
    this.press = null;
    this.canvas.removeClass("is-dragging");
    if (!press || press.drag) return;
    const now = performance.now(), last = this.lastClick;
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
    this.frame = window.requestAnimationFrame((now) => { this.frame = 0; this.draw(now); });
  }

  /** Theme accent → palette shades. The variable may hold calc() text, so let the browser resolve it to rgb(). */
  private readAccent() {
    const probe = this.contentEl.createDiv({ cls: "pdv-accent-probe" });
    const rgb = parseCssRgb(getComputedStyle(probe).color);
    probe.remove();
    this.accent = rgb ? accentColors(rgb) : null;
  }

  private colorContext(): ColorContext {
    return { accent: this.accent, groups: this.plugin.groups, noteGroup: this.plugin.noteGroup };
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
    const css = getComputedStyle(this.contentEl);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
      background: v("--background-primary", "#1e1e1e"),
      disk: v("--background-secondary", "#161616"),
      border: v("--background-modifier-border", "#444"),
      text: v("--text-normal", "#ddd"),
      font: v("--font-interface", "sans-serif"),
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
    const anim = this.anim;
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.dur), k = ease(t);
      if (anim.type === "move") {
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
    const scene = g && L ? {
      g, T: L.T, cellOf: L.cellOf, cells: this.tilings.view(s.p, s.q, s.cellScale),
      V: this.V, shown: this.shown, hover: this.hover, s, color: colorer(s, cc),
      alpha: alpha && alpha.size ? (key: NodeKey) => alpha.get(key) ?? 1 : undefined,
      ghosts,
    } : null;
    const nVis = drawScene(c.getContext("2d")!, f, scene, this.theme());
    this.showStats(nVis);
    this.showLegend(cc);
    if (this.anim) this.requestDraw();
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
    if (this.statsEl.getText() !== text) this.statsEl.setText(text);
  }
}
