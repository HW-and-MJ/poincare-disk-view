// Ported from prototype/tests/test-color.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accentColors, assignGroups, groupOf, hex2rgb, isLight, matchNote, paletteColor, PALETTES, parseCssRgb, parseGroups,
  parseQuery as q, rgb2hsl, type PaletteId,
} from "../src/colors.ts";
import { colorer, legendItems } from "../src/scene.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

test("group queries", () => {
  assert.ok(matchNote(q("path:Research"), "Research/A.md", []));
  assert.ok(!matchNote(q("path:Research"), "Daily/A.md", []));
  assert.ok(matchNote(q("tag:#idea"), "x.md", ["#idea"]));
  assert.ok(matchNote(q("tag:idea"), "x.md", ["#idea/sub"]), "nested tag");
  assert.ok(!matchNote(q("tag:idea"), "x.md", ["#ideas"]), "tag prefix not partial");
  assert.ok(matchNote(q("path:Research -tag:#todo"), "Research/A.md", ["#idea"]));
  assert.ok(!matchNote(q("path:Research -tag:#todo"), "Research/A.md", ["#todo"]));
  assert.ok(matchNote(q("path:Daily OR tag:#idea"), "Reading/B.md", ["#idea"]), "OR");
  assert.ok(matchNote(q('file:"Kernel 5"'), "Ideas/Kernel 51.md", []), "quoted");
  assert.ok(!matchNote(q("file:research"), "Research/A.md", []), "file only name");
});

test("graph.json groups", () => {
  const G = parseGroups(JSON.stringify({ colorGroups: [{ query: "path:Research", color: { a: 1, rgb: 14701138 } }, { query: "tag:#idea", color: "#00ff00" }] }));
  assert.equal(G[0].color, "#e05252");
  assert.equal(G[1].color, "#00ff00");
  assert.equal(groupOf(G, "Research/A.md", ["#idea"]), 0, "first wins");
  assert.equal(groupOf(G, "Daily/A.md", []), -1);
});

test("palettes", () => {
  for (const k of Object.keys(PALETTES) as PaletteId[]) {
    for (let h = 0; h <= 10; h++) assert.match(paletteColor(k, h, 6), /^#[0-9a-f]{6}$/i, k + h);
  }
  assert.equal(paletteColor("viridis", 0, 6), "#440154", "focus darkest");
  assert.equal(paletteColor("viridis", 6, 6), "#fde725", "far lightest");
  // Dark theme: the other way round, so far notes fade into the dark background.
  assert.equal(paletteColor("viridis", 0, 6, null, true), "#fde725");
  assert.equal(paletteColor("viridis", 6, 6, null, true), "#440154");
  assert.ok(isLight("#fde725") && !isLight("#440154"));
});

test("theme accent → light-to-dark shades of the same hue", () => {
  assert.deepEqual(parseCssRgb("rgb(152, 107, 245)"), [152, 107, 245]);
  assert.deepEqual(parseCssRgb("rgba(1, 2, 3, 0.5)"), [1, 2, 3]);
  assert.equal(parseCssRgb("purple"), null);
  // Obsidian default accent hsl(258, 88%, 66%) [checked in Obsidian 2026-11-13]
  const shades = accentColors([152, 107, 245]);
  assert.equal(shades.length, 5);
  const hsl = shades.map((c) => rgb2hsl(hex2rgb(c)));
  for (const [h] of hsl) assert.ok(Math.abs(h - 259) < 3, `hue ${h}`);
  for (let i = 1; i < hsl.length; i++) assert.ok(hsl[i][2] < hsl[i - 1][2], "darker outward");
  assert.ok(isLight(shades[0]) && !isLight(shades[4]));
  assert.equal(paletteColor("accent", 0, 6, shades), shades[shades.length - 1]);
  assert.equal(paletteColor("accent", 0, 6, null), PALETTES.accent.c[PALETTES.accent.c.length - 1], "fallback before the theme is read");
});

test("groups per note, colors and legend", () => {
  const groups = parseGroups(JSON.stringify({ colorGroups: [{ query: "path:Research", color: { a: 1, rgb: 14701138 } }, { query: "tag:#idea", color: { a: 1, rgb: 15909198 } }] }));
  const ng = assignGroups(groups, ["Research/a.md", "Daily/b.md", "Daily/c.md"], [[], ["#idea"], []]);
  assert.deepEqual([...ng], [0, 1, -1]);
  const s = { ...DEFAULT_SETTINGS, colorMode: "group" as const }, cc = { accent: null, groups, noteGroup: ng };
  const color = colorer(s, cc);
  assert.equal(color({ id: 0, hop: 3 }), "#e05252");
  assert.equal(color({ id: 2, hop: 1 }), "#6b6b73");
  assert.equal(color({ id: -1, hop: 1 }), "#4a4a4f", "bundle");
  assert.deepEqual(legendItems(s, cc, 3).map((x) => x.label), ["path:Research (1)", "tag:#idea (1)", "No group (1)"]);
  // Notes in no group take the graph view's node color once the view has read it.
  assert.equal(colorer(s, { ...cc, noGroup: "#123456" })({ id: 2, hop: 1 }), "#123456");
  const hops = legendItems({ ...DEFAULT_SETTINGS, colorMode: "hop" }, cc, 3);
  assert.equal(hops.length, DEFAULT_SETTINGS.maxHop + 1);
  assert.deepEqual(hops.slice(0, 3).map((x) => x.label), ["Focus", "1 hop", "2 hops"]);
});

test("graph.json node size and link thickness multipliers", async () => {
  const { parseGraphDisplay } = await import("../src/colors.ts");
  assert.deepEqual(parseGraphDisplay(JSON.stringify({ nodeSizeMultiplier: 0.6, lineSizeMultiplier: 2.5 })), { nodeSize: 0.6, lineSize: 2.5 });
  assert.deepEqual(parseGraphDisplay(JSON.stringify({ nodeSizeMultiplier: "big" })), { nodeSize: 1, lineSize: 1 });
  assert.deepEqual(parseGraphDisplay("[]"), { nodeSize: 1, lineSize: 1 });
});
