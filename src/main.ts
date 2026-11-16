import { debounce, getAllTags, ItemView, normalizePath, Plugin, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { canFocus, pickInitialFocus } from "./focus.ts";
import { graphFromLinks, noteSignature, type Graph } from "./graph.ts";
import { assignGroups, GRAPH_DISPLAY, PALETTES, parseGraphDisplay, parseGroups, type GraphDisplay, type Group } from "./colors.ts";
import { DEFAULT_SETTINGS, type PdvSettings } from "./settings.ts";
import { FocusSearchModal } from "./search.ts";
import { PoincareDiskView, VIEW_TYPE, type DiskState, type PoincareDisk } from "./view.ts";
import type { C } from "./geometry.ts";
import { GraphDiskOverlay } from "./graph-overlay.ts";
import { readNativeGraph, type NativeSnapshot } from "./projection/native-graph.ts";

export default class PoincareDiskPlugin extends Plugin {
  settings: PdvSettings = { ...DEFAULT_SETTINGS };
  /** Note graph; null until the metadata cache has resolved links. */
  graph: Graph | null = null;
  /** Graph view color groups from .obsidian/graph.json, and the group of each note. */
  groups: Group[] = [];
  noteGroup: Int32Array | null = null;
  /** The graph view's node size and link thickness multipliers, from graph.json. */
  graphDisplay: GraphDisplay = { ...GRAPH_DISPLAY };
  /** Links and tags of each note when the graph was built (see noteSignature). */
  private signatures = new Map<string, string>();
  /** Notes whose metadata changed since the last refresh. */
  private dirty = new Set<string>();
  /** A note was created, deleted or renamed since the last refresh. */
  private structural = false;
  /** Total number of resolved link entries when the graph was built; a cheap check for missed updates. */
  private linkCount = -1;
  private graphJsonMtime = -1;
  private menuOrigin?: { document: Document; point: C; time: number };
  /** Disks drawn over graph views (graph-overlay.ts), one per graph view. */
  private graphOverlays = new Map<ItemView, GraphDiskOverlay>();
  private graphSearch = new Map<ItemView, { button: HTMLButtonElement; cleanup: () => void }>();
  /** Edits arrive in bursts while typing; handle them together. */
  private scheduleRefresh = debounce(() => this.refreshGraph(), 600, true);

  async onload() {
    const saved = (await this.loadData()) as Partial<PdvSettings> | null;
    // Always nodes and links: the filled-cell style is no longer offered, even if an earlier build saved it.
    this.settings = { ...DEFAULT_SETTINGS, ...saved, style: "node" };
    // "Purple shades" duplicated the theme accent palette and was removed.
    if (!(this.settings.palette in PALETTES)) this.settings.palette = DEFAULT_SETTINGS.palette;
    this.registerView(VIEW_TYPE, (leaf) => new PoincareDiskView(leaf, this));
    this.addRibbonIcon("circle-dot", "Open Poincaré disk view", () => this.openView());
    this.addCommand({ id: "open", name: "Open view", callback: () => this.openView() });
    this.addCommand({
      id: "focus-note",
      name: "Find a note to put at the center",
      callback: async () => {
        const view = this.activeGraphView();
        const disk = view && this.graphOverlays.get(view)?.disk;
        if (disk) this.openSearch(disk);
        else if (view) this.searchFromGraph(view);
        else this.openSearch(await this.openView());
      },
    });
    this.addCommand({
      id: "focus-from-graph",
      name: "Search for a center note from the graph view",
      checkCallback: (checking) => {
        const view = this.activeGraphView();
        if (!view || this.graphOverlays.has(view)) return false;
        if (!checking) this.searchFromGraph(view);
        return true;
      },
    });

    this.captureMenuOrigin(document);
    this.registerEvent(this.app.workspace.on("window-open", (_window, win) => this.captureMenuOrigin(win.document)));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const graph = source === "graph-context-menu" && leaf ? leaf : null;
      const point = graph ? this.graphMenuOrigin(graph) : undefined;
      // Current tab: over the graph view that was right-clicked, which stays alive underneath (back returns to it
      // without rebuilding it); from other menus, the open disk tab. New tab: always a new one.
      menu.addItem((item) => item
        .setTitle("Open in Poincaré disk view")
        .setIcon("circle-dot")
        .onClick(() => graph && graph.view instanceof ItemView
          ? this.openOverGraph(graph.view, file.path, point)
          : this.openInView(file.path)));
      menu.addItem((item) => item
        .setTitle("Open in Poincaré disk view (new tab)")
        .setIcon("circle-dot")
        .onClick(() => this.openInLeaf(this.app.workspace.getLeaf("tab"), { path: file.path, unfold: true })));
    }));

    // Follow the note the user opens (like the local graph).
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (this.settings.followActive && file && file.extension === "md") this.disks().forEach((v) => v.setFocus(file.path));
    }));
    // Graph updates: 'changed' names the edited note, 'resolved' says its links are resolved. Create, delete and
    // rename change the set of notes. Vault events are registered after layout-ready because 'create' also fires
    // for every file while the vault loads.
    // 'resolve' also covers links resolved during startup indexing, which sends no 'changed'.
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { this.dirty.add(file.path); }));
    this.registerEvent(this.app.metadataCache.on("resolve", (file) => { this.dirty.add(file.path); }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncGraphSearch()));
    this.app.workspace.onLayoutReady(() => {
      this.syncGraphSearch();
      const structural = () => { this.structural = true; this.scheduleRefresh(); };
      this.registerEvent(this.app.vault.on("create", structural));
      this.registerEvent(this.app.vault.on("delete", structural));
      this.registerEvent(this.app.vault.on("rename", structural));
      this.refreshGraph(true);
    });
  }

  private captureMenuOrigin(doc: Document) {
    this.registerDomEvent(doc, "pointerdown", (event) => {
      this.menuOrigin = event.button === 2
        ? { document: doc, point: { x: event.clientX, y: event.clientY }, time: performance.now() }
        : undefined;
    }, { capture: true });
  }

  private graphMenuOrigin(leaf: WorkspaceLeaf): C | undefined {
    const view = leaf.view;
    const origin = this.menuOrigin;
    this.menuOrigin = undefined;
    if (!origin || origin.document !== view.containerEl.doc || performance.now() - origin.time > 1000) return;
    const { x, y } = origin.point;
    const { left, right, top, bottom } = view.containerEl.getBoundingClientRect();
    if (x >= left && x <= right && y >= top && y <= bottom) return origin.point;
  }

  private activeGraphView(): ItemView | null {
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    return view instanceof ItemView && ["graph", "localgraph"].includes(view.getViewType()) ? view : null;
  }

  private syncGraphSearch() {
    const views = new Set<ItemView>();
    for (const type of ["graph", "localgraph"]) for (const { view } of this.app.workspace.getLeavesOfType(type)) {
      if (view instanceof ItemView && view.contentEl.isConnected) views.add(view);
    }
    for (const [view, control] of this.graphSearch) {
      if (views.has(view) && control.button.parentElement === view.contentEl) continue;
      control.cleanup();
      this.graphSearch.delete(view);
    }
    for (const view of views) {
      if (this.graphSearch.has(view)) continue;
      const el = view.contentEl;
      const positioned = el.win.getComputedStyle(el).position === "static";
      if (positioned) el.addClass("pdv-graph-search-host");
      const button = el.createEl("button", {
        cls: "pdv-graph-search",
        attr: { type: "button", "aria-label": "Search for a Poincaré center note", "aria-haspopup": "dialog" },
      });
      setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), "search");
      button.createSpan({ text: "Search center note…" });
      button.addEventListener("click", () => {
        const disk = this.graphOverlays.get(view)?.disk;
        if (disk) this.openSearch(disk);
        else this.searchFromGraph(view);
      });
      this.graphSearch.set(view, { button, cleanup: () => {
        button.remove();
        if (positioned) el.removeClass("pdv-graph-search-host");
      } });
    }
  }

  private searchFromGraph(view: ItemView) {
    // Search note filenames in a modal. Never write the native graph search/filter or open the note editor.
    new FocusSearchModal(this.app, this.app.vault.getMarkdownFiles(), (file) => {
      // Let the picker close before the overlay takes keyboard focus (including Escape).
      view.contentEl.win.requestAnimationFrame(() => this.openOverGraph(view, file.path));
    }).open();
  }

  onunload() {
    for (const [view, overlay] of this.graphOverlays) view.removeChild(overlay);
    for (const { cleanup } of this.graphSearch.values()) cleanup();
    this.graphSearch.clear();
  }

  /** Draw the disk over this graph view. Its drawing is read first so its nodes can morph onto the disk. */
  private openOverGraph(view: ItemView, path: string, point?: C) {
    if (!view.contentEl.isConnected) return;
    const previous = this.graphOverlays.get(view);
    if (previous) view.removeChild(previous);
    let snapshot: NativeSnapshot | null = null;
    if (this.settings.openAnimation) {
      try {
        snapshot = readNativeGraph(view);
      } catch (error) {
        console.error("Poincaré disk view: could not read the graph view", error);
      }
    }
    const overlay = new GraphDiskOverlay(view, this, path, snapshot, point, () => this.graphOverlays.delete(view));
    this.graphOverlays.set(view, overlay);
    view.addChild(overlay);
  }

  private countLinks() {
    let n = 0;
    for (const dsts of Object.values(this.app.metadataCache.resolvedLinks)) n += Object.keys(dsts).length;
    return n;
  }

  private tagsOf(file: TFile) {
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache && getAllTags(cache)) || [];
  }

  private signatureOf(path: string, isNote: (p: string) => boolean) {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? noteSignature(this.app.metadataCache.resolvedLinks[path], this.tagsOf(f), isNote) : "";
  }

  /**
   * Rebuild the graph, unless only note contents changed and none of their links or tags did (the usual case while
   * typing). Views carry what is on screen over to the new graph and blend into the new layout.
   */
  refreshGraph(force = false) {
    const isNote = (p: string) => p.endsWith(".md") && this.app.vault.getAbstractFileByPath(p) instanceof TFile;
    if (!force && this.graph && !this.structural && this.countLinks() === this.linkCount) {
      const changed = [...this.dirty].some((p) => this.signatureOf(p, isNote) !== (this.signatures.get(p) ?? ""));
      this.dirty.clear();
      if (!changed) return;
    }
    this.dirty.clear();
    this.structural = false;

    const files = this.app.vault.getMarkdownFiles();
    const md = new Set(files.map((f) => f.path)), keep = (p: string) => md.has(p);
    const tags: Record<string, string[]> = {};
    this.signatures.clear();
    for (const f of files) {
      tags[f.path] = this.tagsOf(f);
      this.signatures.set(f.path, noteSignature(this.app.metadataCache.resolvedLinks[f.path], tags[f.path], keep));
    }
    this.linkCount = this.countLinks();
    const old = this.graph;
    this.graph = graphFromLinks(this.app.metadataCache.resolvedLinks, tags, keep);
    this.noteGroup = assignGroups(this.groups, this.graph.paths, this.graph.tags);
    void this.loadGroups();
    for (const v of this.disks()) {
      if (!v.canKeepFocus()) v.resetFocus(this.initialFocus());
      else if (old) v.graphChanged(old, this.graph);
      else v.relayout();
    }
  }

  /**
   * Reads the graph view's color groups. There is no public API for them, so this reads graph.json directly;
   * its format is not public and may change. A missing or broken file means no groups.
   */
  async loadGroups() {
    const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
    let groups: Group[] = [];
    try {
      const mtime = (await this.app.vault.adapter.stat(path))?.mtime ?? 0;
      if (mtime === this.graphJsonMtime) return; // unchanged since last read; noteGroup is kept current by refreshGraph
      this.graphJsonMtime = mtime;
      const text = await this.app.vault.adapter.read(path);
      groups = parseGroups(text);
      this.graphDisplay = parseGraphDisplay(text);
    } catch {
      groups = [];
      this.graphDisplay = { ...GRAPH_DISPLAY };
    }
    for (const v of this.disks()) v.requestDraw(); // node size or link thickness may have changed
    const same = JSON.stringify(groups.map((g) => [g.query, g.color])) === JSON.stringify(this.groups.map((g) => [g.query, g.color]));
    if (same && this.noteGroup) return;
    this.groups = groups;
    if (this.graph) this.noteGroup = assignGroups(groups, this.graph.paths, this.graph.tags);
    for (const v of this.disks()) v.requestDraw();
  }

  private saveSettings = debounce(() => this.saveData(this.settings), 500, true);

  /** Apply a settings change from the panel: save, then re-check the focus and redraw every view. */
  updateSettings(patch: Partial<PdvSettings>) {
    Object.assign(this.settings, patch);
    this.saveSettings();
    if (patch.colorMode === "group") void this.loadGroups(); // pick up groups edited in the graph view
    for (const v of this.disks()) {
      if (v.focusPath && !v.canKeepFocus()) v.resetFocus(this.initialFocus());
      else v.relayout();
    }
  }

  /** Open a note from the view. Reuses the last markdown tab unless newTab (Cmd/Ctrl+double-click). */
  async openNote(path: string, newTab: boolean) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const ws = this.app.workspace;
    let leaf = null;
    if (!newTab) {
      const recent = ws.getMostRecentLeaf();
      leaf = recent && recent.view.getViewType() === "markdown" ? recent : ws.getLeavesOfType("markdown")[0] ?? null;
    }
    await (leaf ?? ws.getLeaf("tab")).openFile(file);
  }

  openSearch(view: PoincareDisk) {
    const files = this.app.vault.getMarkdownFiles().filter((f) => this.canFocus(f.path));
    new FocusSearchModal(this.app, files, (f) => view.setFocus(f.path)).open();
  }

  canFocus(path: string, allowOrphan = false) {
    return canFocus(this.graph, path, this.settings.showOrphans || allowOrphan);
  }

  /** Most recent note that can be the focus, otherwise the note with the most links. */
  initialFocus(): string | null {
    const ws = this.app.workspace;
    const isNote = (p: string) => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof TFile && f.extension === "md" && this.canFocus(p);
    };
    return pickInitialFocus(
      [ws.getActiveFile()?.path, ...ws.getLastOpenFiles()],
      this.app.metadataCache.resolvedLinks,
      isNote,
    );
  }

  private disks(): PoincareDisk[] {
    const disks: PoincareDisk[] = [];
    for (const { view } of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (view instanceof PoincareDiskView && view.disk) disks.push(view.disk);
    }
    for (const overlay of this.graphOverlays.values()) if (overlay.disk) disks.push(overlay.disk);
    return disks;
  }

  /** Center a note chosen from a file menu in the open disk tab (or a new one) and play the opening transition. */
  private async openInView(path: string) {
    const disk = await this.openView();
    disk.resetFocus(path, { allowOrphan: true });
    disk.enterFrom();
  }

  /** Show the disk in this tab. Replacing another view there is recorded in the tab's back history. */
  private async openInLeaf(leaf: WorkspaceLeaf, state: DiskState) {
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { ...state } });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Reuse an open view, otherwise open one in a new tab (like the graph view). */
  async openView(): Promise<PoincareDisk> {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = ws.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await ws.revealLeaf(leaf);
    return (leaf.view as PoincareDiskView).disk;
  }
}
