// Ported from prototype/tests/test-core.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { abs2, along, distFromOrigin, fromOrigin, hdist, mApply, mMul, scaleRadial, toOrigin } from "../src/geometry.ts";
import { buildTree, graphFromLinks } from "../src/graph.ts";
import { layoutTiling, makeTiling, scaleTiling, TILING_PRESETS } from "../src/tiling.ts";
import { layoutFocus, TilingCache } from "../src/scene.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { genGraph, mostLinked } from "./fake-graph.ts";

const close = (a: number, b: number, e = 1e-9) => Math.abs(a - b) < e;
const u = { x: 0.3, y: -0.5 }, v = { x: -0.6, y: 0.2 }, a = { x: 0.4, y: 0.4 }, b = { x: -0.2, y: 0.5 };

test("Möbius: composition, isometry, a → b, along", () => {
  const M = mMul(fromOrigin(b), toOrigin(a));
  const z = mApply(M, u), z2 = mApply(fromOrigin(b), mApply(toOrigin(a), u));
  assert.ok(close(z.x, z2.x) && close(z.y, z2.y), "compose");
  assert.ok(close(hdist(u, v), hdist(mApply(M, u), mApply(M, v))), "isometry");
  const ma = mApply(M, a);
  assert.ok(close(ma.x, b.x) && close(ma.y, b.y), "a -> b");
  assert.ok(close(distFromOrigin(along(a, 0.5)), distFromOrigin(a) / 2), "along");
});

test("tiling: q cells meet at every vertex, Euclidean {4,4} rejected", () => {
  for (const [p, q] of TILING_PRESETS) {
    const cells = makeTiling(p, q)!;
    const v0 = cells[0].v[0];
    const n = cells.filter((c) => c.v.some((w) => Math.hypot(w.x - v0.x, w.y - v0.y) < 1e-6)).length;
    assert.equal(n, q, `{${p},${q}}`);
  }
  assert.equal(makeTiling(4, 4), null);
});

test("tree keys are unique and every placed node is inside the disk", () => {
  const g = genGraph(800, 2, 7);
  const T = buildTree(g, mostLinked(g), { maxHop: 4, hub: 1, maxKids: 16 });
  assert.equal(new Set(T.nodes.map((n) => n.key)).size, T.nodes.length);
  const { pos } = layoutTiling(T, makeTiling(7, 3));
  for (const z of pos.values()) assert.ok(Number.isFinite(z.x) && abs2(z) < 1);
  assert.ok(pos.size > 50, `placed ${pos.size}`);
});

test("graphFromLinks: names, summed link counts, tag-only notes, filtered paths", () => {
  const g = graphFromLinks({ "a/x.md": { "b.md": 2, "c.md": 1, "pic.png": 1 }, "b.md": { "a/x.md": 1 }, "d.md": {} }, {}, (p) => p.endsWith(".md"));
  assert.deepEqual(g.names, ["x", "b", "c", "d"]);
  assert.equal(g.adj[0].get(1), 3);
  assert.equal(g.index.get("c.md"), 2);
  const g2 = graphFromLinks({ "a.md": { "b.md": 1 } }, { "a.md": ["#x"], "lonely.md": ["#y"] });
  assert.deepEqual(g2.names, ["a", "lonely", "b"]);
  assert.equal(g2.tags[1][0], "#y");
  assert.equal(g2.tags[2].length, 0);
  assert.equal(g2.adj[1].size, 0);
});

test("cell size multiplier scales distance and keeps cells inside", () => {
  const zz = { x: 0.3, y: -0.4 };
  assert.ok(close(distFromOrigin(scaleRadial(zz, 1.7)), 1.7 * distFromOrigin(zz)));
  assert.ok(scaleTiling(makeTiling(7, 3)!, 0.5).every((c) => c.v.every((w) => abs2(w) < 1)));
});

test("layoutFocus with default settings; same cells for any λ", () => {
  const g = genGraph(800, 2, 7), f = mostLinked(g), tc = new TilingCache();
  const L1 = layoutFocus(g, f, DEFAULT_SETTINGS, tc);
  const L2 = layoutFocus(g, f, { ...DEFAULT_SETTINGS, cellScale: 0.5 }, tc);
  assert.deepEqual([...L1.cellOf], [...L2.cellOf]);
  const k = [...L1.pos.keys()][1];
  assert.ok(close(distFromOrigin(L2.pos.get(k)!), 0.5 * distFromOrigin(L1.pos.get(k)!), 1e-6));
  assert.equal(tc.get(7, 3), tc.get(7, 3), "cached");
});
