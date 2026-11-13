import { debounce, getAllTags, Plugin, TFile } from "obsidian";
import { canFocus, pickInitialFocus } from "./focus.ts";
import { graphFromLinks, type Graph } from "./graph.ts";
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

  async onload() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
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
    // 'resolved' fires after the initial indexing and again after edits. Debouncing and finer updates come in M5.
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.refreshGraph()));
    this.app.workspace.onLayoutReady(() => this.refreshGraph());
  }

  refreshGraph() {
    const files = this.app.vault.getMarkdownFiles();
    const tags: Record<string, string[]> = {};
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f);
      tags[f.path] = (cache && getAllTags(cache)) || [];
    }
    const md = new Set(files.map((f) => f.path));
    this.graph = graphFromLinks(this.app.metadataCache.resolvedLinks, tags, (p) => md.has(p));
    this.noteGroup = assignGroups(this.groups, this.graph.paths, this.graph.tags);
    void this.loadGroups();
    for (const v of this.views()) {
      if (v.focusPath && this.canFocus(v.focusPath)) v.relayout();
      else v.resetFocus(this.initialFocus());
    }
  }

  /**
   * Reads the graph view's color groups. There is no public API for them, so this reads graph.json directly;
   * its format is not public and may change. A missing or broken file means no groups.
   */
  async loadGroups() {
    let groups: Group[] = [];
    try {
      groups = parseGroups(await this.app.vault.adapter.read(`${this.app.vault.configDir}/graph.json`));
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
