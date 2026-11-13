# Poincaré disk view

**A focus view for vaults that have grown too large to see at once.**

![Poincaré disk view: clicking a note brings it to the center, dragging looks around, and notes can be drawn as nodes or as tiling cells](docs/demo.gif)

<sub>Rendered with the plugin's own layout and drawing code on a generated vault of 800 notes, in Obsidian's default dark theme.</sub>

Once a vault holds hundreds or thousands of notes, the graph view stops showing structure. Every note is drawn with the same weight, the links pile up into one dense tangle, and the notes around the one you are working on are lost in the crowd.

Poincaré disk view starts from a single note instead of the whole vault. It puts that note at the center of a [Poincaré disk](https://en.wikipedia.org/wiki/Poincar%C3%A9_disk_model), a picture of the hyperbolic plane in which space grows exponentially toward the rim, and places the surrounding notes on a regular hyperbolic tiling:

- Notes one or two links away get large, readable cells near the center.
- Notes farther away shrink toward the rim and fade out. They stay in view as context but no longer compete for attention.
- Click any note and the disk glides to put it at the center, unfolding its own neighborhood.

This is focus + context for your notes: one note's neighborhood in detail, and the rest of the vault as a horizon. Hyperbolic space suits link neighborhoods because both grow exponentially. A circle of radius r has circumference 2π·sinh r, so the notes two, three and four links out still fit without piling up. The approach follows the hyperbolic browser of Lamping, Rao and Pirolli (CHI '95).

## Use

- Open it from the ribbon (circle icon) or the command **Poincaré disk view: Open view**.
- The view starts at the note you opened most recently, or at the most linked note.
- **Click** a note to move it to the center. **Drag** to move around the disk.
- **Double-click** a note to open it. Hold <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> to open it in a new tab.
- Hover a note for its path, distance and tags.
- With **Follow active note** on, the view follows the note open in the editor.
- The buttons at the top right: find a note to put at the center, re-center after dragging, and settings.

## Settings

The settings panel (gear button) changes the view right away:

- **Style**: nodes and links, or filled tiling cells.
- **Color by**: distance from the center (palettes include one built from your theme accent), or the groups from the graph view settings.
- **Tiling**: the regular hyperbolic tiling {p,q} the notes are placed on.
- **Layout**: max hops, hub penalty, max children per note (extras are bundled into a +N cell), hide radius.
- **Size**: cell size, node size, label threshold, cross-link opacity.
- Notes without any links are hidden unless **Show orphans** is on.

Graph view groups are read from `.obsidian/graph.json`. Only `path:`, `file:`, `tag:`, `-` and `OR` are supported; plain words match the file path, not the note content.

## Install

Until the plugin is listed in Community plugins: download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/poincare-disk-view/`, then enable the plugin. Or install with [BRAT](https://github.com/TfTHacker/obsidian42-brat) using this repository's URL.

Desktop only for now.

## Development

```bash
npm install
npm run dev     # watch and rebuild main.js
npm test        # Node 22.18+ (runs the TypeScript tests directly)
npm run build   # type check and production build
```

Release: `npm run bump -- 0.2.0`, commit, then push a tag `0.2.0`. GitHub Actions builds a draft release with the plugin files.

## License

MIT
