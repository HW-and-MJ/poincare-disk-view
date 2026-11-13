// Smoke test: draw a frame into a recording fake canvas and check every coordinate is finite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { M_ID } from "../src/geometry.ts";
import { drawScene, type Scene } from "../src/render.ts";
import { colorer, layoutFocus, TilingCache } from "../src/scene.ts";
import { DEFAULT_SETTINGS, type PdvSettings } from "../src/settings.ts";
import { genGraph, mostLinked } from "./fake-graph.ts";

function fakeCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => { calls.push({ name: prop, args }); };
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const theme = { background: "#111", disk: "#000", border: "#333", text: "#ddd", font: "sans-serif" };

for (const style of ["cell", "node"] as const) {
  test(`draws ${style} style with finite coordinates`, () => {
    const s: PdvSettings = { ...DEFAULT_SETTINGS, style };
    const g = genGraph(800, 2, 7), tc = new TilingCache();
    const L = layoutFocus(g, mostLinked(g), s, tc);
    const scene: Scene = { g, T: L.T, cellOf: L.cellOf, cells: tc.view(s.p, s.q, s.cellScale), V: M_ID, shown: L.pos, hover: null, s, color: colorer(s, { accent: null, groups: [], noteGroup: null }) };
    const { ctx, calls } = fakeCtx();
    const n = drawScene(ctx, { w: 1600, h: 1000, dpr: 2 }, scene, theme);
    assert.ok(n > 50, `visible ${n}`);
    const bad = calls.filter((c) => ["moveTo", "lineTo", "arc", "fillText"].includes(c.name)
      && c.args.some((x) => typeof x === "number" && !Number.isFinite(x)));
    assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 3)));
    assert.ok(calls.filter((c) => c.name === "fillText").length > 5, "labels drawn");
  });
}

test("no scene draws only the empty disk", () => {
  const { ctx, calls } = fakeCtx();
  assert.equal(drawScene(ctx, { w: 400, h: 300, dpr: 1 }, null, theme), 0);
  assert.equal(calls.filter((c) => c.name === "fill").length, 1);
});
