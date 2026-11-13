// The in-view settings panel opened by the gear button, like the graph view's.
import { Setting } from "obsidian";
import { PALETTES, type PaletteId } from "./colors.ts";
import {
  DEFAULT_SETTINGS, LAYOUT_SLIDERS, SIZE_SLIDERS, TILING_LABELS, TOGGLES,
  type PdvSettings, type SliderSpec, type ToggleSpec,
} from "./settings.ts";

export interface PanelHost {
  settings: PdvSettings;
  /** Called after every change; the host saves and redraws. */
  updateSettings(patch: Partial<PdvSettings>): void;
}

export function buildPanel(el: HTMLElement, host: PanelHost) {
  el.empty();
  const s = host.settings;
  const rebuild = () => buildPanel(el, host);
  const set = (patch: Partial<PdvSettings>) => host.updateSettings(patch);
  const section = (title: string) => {
    el.createDiv({ cls: "pdv-panel-heading", text: title });
    return el.createDiv({ cls: "pdv-panel-section" });
  };
  const slider = (parent: HTMLElement, sp: SliderSpec) => {
    const st = new Setting(parent).setName(sp.label);
    if (sp.desc) st.setDesc(sp.desc);
    st.addSlider((c) => c.setLimits(sp.min, sp.max, sp.step).setValue(s[sp.key]).setInstant(true)
      .onChange((v) => set({ [sp.key]: v })));
  };
  const toggle = (parent: HTMLElement, key: ToggleSpec["key"]) => {
    const t = TOGGLES.find((x) => x.key === key)!, st = new Setting(parent).setName(t.label);
    if (t.desc) st.setDesc(t.desc);
    st.addToggle((c) => c.setValue(s[t.key]).onChange((v) => set({ [t.key]: v })));
  };

  const look = section("Display");
  new Setting(look).setName("Style").addDropdown((d) => d
    .addOptions({ cell: "Filled cells", node: "Nodes and links" })
    .setValue(s.style).onChange((v) => set({ style: v as PdvSettings["style"] })));
  new Setting(look).setName("Color by")
    .setDesc(s.colorMode === "group" ? "Groups from the graph view settings" : "")
    .addDropdown((d) => d
      .addOptions({ hop: "Distance (hops)", group: "Graph view groups" })
      .setValue(s.colorMode).onChange((v) => { set({ colorMode: v as PdvSettings["colorMode"] }); rebuild(); }));
  if (s.colorMode === "hop") {
    new Setting(look).setName("Palette").addDropdown((d) => {
      for (const [k, p] of Object.entries(PALETTES)) d.addOption(k, p.name);
      d.setValue(s.palette).onChange((v) => set({ palette: v as PaletteId }));
    });
  }
  new Setting(look).setName("Tiling").addDropdown((d) => d
    .addOptions(TILING_LABELS).setValue(`${s.p},${s.q}`)
    .onChange((v) => { const [p, q] = v.split(",").map(Number); set({ p, q }); }));
  toggle(look, "grid");
  toggle(look, "showLegend");

  const layout = section("Layout");
  for (const sp of LAYOUT_SLIDERS) slider(layout, sp);
  const size = section("Size");
  for (const sp of SIZE_SLIDERS) slider(size, sp);
  const behave = section("Behavior");
  toggle(behave, "followActive");
  toggle(behave, "showOrphans");

  new Setting(el).addButton((b) => b.setButtonText("Restore defaults").onClick(() => {
    set({ ...DEFAULT_SETTINGS });
    rebuild();
  }));
}
