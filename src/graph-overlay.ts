// The disk drawn over the built-in graph view, in the same tab. The graph view stays alive underneath, untouched, so
// returning does not rebuild it: its nodes morph onto the disk when opening, and back onto exactly where the graph
// draws them when closing, as if the same space were seen through a different lens.
import { Component, type ItemView } from "obsidian";
import type { C } from "./geometry.ts";
import type PoincareDiskPlugin from "./main.ts";
import { readNativeGraph, type NativeSnapshot } from "./projection/native-graph.ts";
import { PoincareDisk } from "./view.ts";

/** The overlay fades in or out this fast when there is no morph, and at the very end of the return. */
const FADE_MS = 160;

export class GraphDiskOverlay extends Component {
  disk?: PoincareDisk;
  private surface!: HTMLElement;
  private closing = false;
  private fade?: Animation;

  constructor(
    private readonly view: ItemView,
    private readonly plugin: PoincareDiskPlugin,
    private readonly path: string,
    private readonly snapshot: NativeSnapshot | null,
    private readonly point: C | undefined,
    private readonly onRemove: () => void,
  ) {
    super();
  }

  onload() {
    const host = this.view.contentEl;
    if (host.win.getComputedStyle(host).position === "static") {
      host.addClass("pdv-graph-host");
      this.register(() => host.removeClass("pdv-graph-host"));
    }
    this.surface = host.createDiv({
      cls: "pdv-graph-overlay",
      attr: { tabindex: "-1", "aria-label": "Poincaré disk view. Press Escape or back to return to the graph." },
    });
    const disk = this.disk = this.addChild(new PoincareDisk(this.surface, this.plugin));
    disk.backHint = true;
    disk.resetFocus(this.path, { allowOrphan: true });

    if (this.snapshot && this.motion()) disk.morphFrom(this.snapshot);
    else if (this.motion()) { this.fadeIn(); disk.enterFrom(this.point); }

    // Back: Esc, the mouse back button, and this tab's back button (the tab's history is not changed by the overlay).
    this.registerDomEvent(this.surface, "keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    const mouseBack = (event: MouseEvent) => {
      if (event.button !== 3) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "mouseup") this.close();
    };
    this.registerDomEvent(this.surface, "mousedown", mouseBack);
    this.registerDomEvent(this.surface, "mouseup", mouseBack);
    this.captureBackButton();
    this.surface.focus({ preventScroll: true });
  }

  /** While the overlay is open, this tab's back button closes it instead of leaving the graph. */
  private captureBackButton() {
    const back = this.view.containerEl.querySelector(".view-header-nav-buttons")?.firstElementChild;
    if (!back?.instanceOf(HTMLElement)) return;
    // With no history the button is disabled; enable it for the overlay and restore it afterwards.
    const disabled = back.hasAttribute("disabled"), dimmed = back.hasClass("is-disabled");
    back.removeAttribute("disabled");
    back.removeClass("is-disabled");
    this.register(() => {
      if (disabled) back.setAttribute("disabled", "");
      if (dimmed) back.addClass("is-disabled");
    });
    this.registerDomEvent(this.view.containerEl, "click", (event) => {
      const target = event.target as Node | null;
      if (!target || !back.contains(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    }, { capture: true });
  }

  private motion() {
    return this.plugin.settings.openAnimation && !this.surface.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private fadeIn() {
    this.fade = this.surface.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
  }

  /** Morph back onto where the graph view draws its nodes now, then lift the overlay off the live graph. */
  close() {
    if (this.closing) return;
    this.closing = true;
    const disk = this.disk;
    let live: NativeSnapshot | null = null;
    try { live = readNativeGraph(this.view); } catch { live = null; }
    const target = live ?? this.snapshot;
    if (disk && target && this.motion()) disk.morphBack(target.frame, target.edgeColor, () => this.lift());
    else this.lift();
  }

  private lift() {
    if (!this.motion()) { this.view.removeChild(this); return; }
    this.fade?.cancel();
    this.fade = this.surface.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-in", fill: "forwards" });
    this.fade.onfinish = () => this.view.removeChild(this);
  }

  onunload() {
    this.fade?.cancel();
    this.surface?.remove();
    this.disk = undefined;
    this.onRemove();
  }
}
