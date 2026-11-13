import { debounce, getAllTags, normalizePath, Plugin, TFile } from "obsidian";
import { canFocus, pickInitialFocus } from "./focus.ts";
import { graphFromLinks, noteSignature, type Graph } from "./graph.ts";
import { assignGroups, parseGroups, type Group } from "./colors.ts";
import { DEFAULT_SETTINGS, type PdvSettings } from "./settings.ts";
import { FocusSearchModal } from "./search.ts";
import { PoincareDiskView, VIEW_TYPE } from "./view.ts";

export default class PoincareDiskPlugin extends Plugin {
  settings: PdvSettings = { ...DEFAULT_SETTINGS };
  /** Note graph; null until the metadata cache has resolved links. */
  graph: Graph | null = null;
  /** Graph view color groups from .obsidian/graph.json, and the group of each note. */
  groups: Group[] = [];
  noteGroup: Int32Array | null = null;
  /** Links and tags of each note when the graph was built (see noteSignature). */
  private signatures = new Map<string, string>();
  /** Notes whose metadata changed since the last refresh. */
  private dirty = new Set<string>();
  /** A note was created, deleted or renamed since the last refresh. */
  private structural = false;
  /** Total number of resolved link entries when the graph was built; a cheap check for missed updates. */
  private linkCount = -1;
  private graphJsonMtime = -1;
  /** Edits arrive in bursts while typing; handle them together. */
  private scheduleRefresh = debounce(() => this.refreshGraph(), 600, true);

  async onload() {
    const saved = (await this.loadData()) as Partial<PdvSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    this.registerView(VIEW_TYPE, (leaf) => new PoincareDiskView(leaf, this));
    this.addRibbonIcon("circle-dot", "Open Poincaré disk view", () => this.openView());
    this.addCommand({ id: "open", name: "Open view", callback: () => this.openView() });
    this.addCommand({
      id: "focus-note",
      name: "Find a note to put at the center",
      callback: async () => this.openSearch(await this.openView()),
    });

    // Follow the note the user opens (like the local graph).
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (this.settings.followActive && file && file.extension === "md") this.views().forEach((v) => v.setFocus(file.path));
    }));
    // Graph updates: 'changed' names the edited note, 'resolved' says its links are resolved. Create, delete and
    // rename change the set of notes. Vault events are registered after layout-ready because 'create' also fires
    // for every file while the vault loads.
    // 'resolve' also covers links resolved during startup indexing, which sends no 'changed'.
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { this.dirty.add(file.path); }));
    this.registerEvent(this.app.metadataCache.on("resolve", (file) => { this.dirty.add(file.path); }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => {
      const structural = () => { this.structural = true; this.scheduleRefresh(); };
      this.registerEvent(this.app.vault.on("create", structural));
      this.registerEvent(this.app.vault.on("delete", structural));
      this.registerEvent(this.app.vault.on("rename", structural));
      this.refreshGraph(true);
    });
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
    for (const v of this.views()) {
      if (!v.focusPath || !this.canFocus(v.focusPath)) v.resetFocus(this.initialFocus());
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
      groups = parseGroups(await this.app.vault.adapter.read(path));
    } catch {
      groups = [];
    }
    const same = JSON.stringify(groups.map((g) => [g.query, g.color])) === JSON.stringify(this.groups.map((g) => [g.query, g.color]));
    if (same && this.noteGroup) return;
    this.groups = groups;
    if (this.graph) this.noteGroup = assignGroups(groups, this.graph.paths, this.graph.tags);
    for (const v of this.views()) v.requestDraw();
  }

  private saveSettings = debounce(() => this.saveData(this.settings), 500, true);

  /** Apply a settings change from the panel: save, then re-check the focus and redraw every view. */
  updateSettings(patch: Partial<PdvSettings>) {
    Object.assign(this.settings, patch);
    this.saveSettings();
    if (patch.colorMode === "group") void this.loadGroups(); // pick up groups edited in the graph view
    for (const v of this.views()) {
      if (v.focusPath && !this.canFocus(v.focusPath)) v.resetFocus(this.initialFocus());
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

  openSearch(view: PoincareDiskView) {
    const files = this.app.vault.getMarkdownFiles().filter((f) => this.canFocus(f.path));
    new FocusSearchModal(this.app, files, (f) => view.setFocus(f.path)).open();
  }

  canFocus(path: string) {
    return canFocus(this.graph, path, this.settings.showOrphans);
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

  private views(): PoincareDiskView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .map((l) => l.view)
      .filter((v): v is PoincareDiskView => v instanceof PoincareDiskView);
  }

  /** Reuse an open view, otherwise open one in a new tab (like the graph view). */
  async openView(): Promise<PoincareDiskView> {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = ws.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await ws.revealLeaf(leaf);
    return leaf.view as PoincareDiskView;
  }
}
