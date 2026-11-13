import { App, FuzzySuggestModal, TFile } from "obsidian";

/** Pick a note to put at the center. */
export class FocusSearchModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onPick: (file: TFile) => void;

  constructor(app: App, files: TFile[], onPick: (file: TFile) => void) {
    super(app);
    this.files = files;
    this.onPick = onPick;
    this.setPlaceholder("Find a note to put at the center");
  }

  getItems() { return this.files; }
  getItemText(f: TFile) { return f.path.replace(/\.md$/, ""); }
  onChooseItem(f: TFile) { this.onPick(f); }
}
