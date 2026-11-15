import { test } from "node:test";
import assert from "node:assert/strict";
import { M_ID } from "../src/geometry.ts";
import { classicFrame } from "../src/classic-morph.ts";
import { blendShown, cellPx, diskOf } from "../src/motion.ts";
import { diskBend } from "../src/projection/projection.ts";
import type { Scene } from "../src/render.ts";
import { colorer, layoutFocus, TilingCache } from "../src/scene.ts";
import { DEFAULT_SETTINGS, type PdvSettings } from "../src/settings.ts";
import { genGraph, mostLinked } from "./fake-graph.ts";

const theme = { background: "#ffffff", disk: "#f6f6f6", border: "#e0e0e0", text: "#222222", font: "sans-serif" };

test("classicFrame describes exactly what the classic disk draws, in CSS px", () => {
  const s: PdvSettings = { ...DEFAULT_SETTINGS, cross: 0.06 };
  const g = genGraph(800, 2, 7), tc = new TilingCache(), L = layoutFocus(g, mostLinked(g), s, tc);
  const cells = tc.view(s.p, s.q, s.cellScale), shown = blendShown(L.pos, M_ID, null, 1).shown;
  const scene: Scene = { g, T: L.T, cellOf: L.cellOf, cells, V: M_ID, shown, hover: null, s,
    color: colorer(s, { accent: null, groups: [], noteGroup: null }) };
  const f = { w: 1600, h: 1000, dpr: 2 }, { R, X, Y } = diskOf(f);
  const frame = classicFrame(scene, f, theme);
  assert.equal(frame.width, 800);
  assert.equal(frame.nodes.size, L.T.nodes.length);

  const focus = L.T.nodes[0], z = shown.get(focus.key)!, n = frame.nodes.get(g.paths[focus.id])!;
  assert.ok(Math.abs(n.x - (X + R * z.x) / 2) < 1e-9 && Math.abs(n.y - (Y + R * z.y) / 2) < 1e-9);
  assert.ok(Math.abs(n.radius - Math.max(1.5 * 2, cellPx(z, cells, f) * s.nodeFill * 0.5) / 2) < 1e-9);
  assert.equal(n.color, scene.color(focus));

  // Every tree link is there, keyed like the graph view's links and bent into the disk geodesic.
  const child = L.T.nodes.find((m) => m.parent === focus && m.id >= 0)!;
  const [a, b] = [g.paths[focus.id], g.paths[child.id]].sort();
  const link = frame.links.get(JSON.stringify([a, b]))!;
  assert.ok(link && link.source === a && link.target === b);
  const za = a === g.paths[focus.id] ? z : shown.get(child.key)!, zb = a === g.paths[focus.id] ? shown.get(child.key)! : z;
  assert.equal(link.bend, diskBend(za, zb));
  const tree = [...frame.links.values()].filter((l) => l.color === theme.text).length;
  assert.equal(tree, L.T.nodes.length - 1);
});
