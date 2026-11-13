import { test } from "node:test";
import assert from "node:assert/strict";
import { abs2, hdist, mApply, M_ID } from "../src/geometry.ts";
import { bestRotation, blendShown, diskOf, dragTransform, FAR, geoLerp, hitTest, moveTransform, rotation, toDisk } from "../src/motion.ts";
import { layoutFocus, TilingCache } from "../src/scene.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { genGraph, mostLinked } from "./fake-graph.ts";

const f = { w: 1600, h: 1000, dpr: 2 };
const close = (a: number, b: number, e = 1e-9) => Math.abs(a - b) < e;
const screen = (z: { x: number; y: number }) => { const { R, X, Y } = diskOf(f); return { px: X + R * z.x, py: Y + R * z.y }; };

test("toDisk inverts the disk-to-screen map and clamps at the rim", () => {
  const z = { x: 0.3, y: -0.2 }, { px, py } = screen(z), back = toDisk(px, py, f);
  assert.ok(close(back.x, z.x) && close(back.y, z.y));
  const rim = toDisk(f.w, f.h / 2, f);
  assert.ok(close(Math.sqrt(abs2(rim)), 0.97));
});

test("drag moves the grabbed point to the pointer; focus move ends at the origin", () => {
  const p0 = { x: 0.2, y: 0.1 }, p1 = { x: -0.3, y: 0.4 };
  const q = mApply(dragTransform(M_ID, p0, p1), p0);
  assert.ok(close(q.x, p1.x) && close(q.y, p1.y));
  const a = { x: 0.5, y: -0.3 };
  const end = mApply(moveTransform(M_ID, a, 1), a), start = mApply(moveTransform(M_ID, a, 0), a);
  assert.ok(close(abs2(end), 0, 1e-18));
  assert.ok(close(start.x, a.x) && close(start.y, a.y));
});

test("hit test finds the cell under the pointer in both styles", () => {
  const g = genGraph(800, 2, 7), focus = mostLinked(g), tc = new TilingCache();
  for (const style of ["cell", "node"] as const) {
    const s = { ...DEFAULT_SETTINGS, style };
    const L = layoutFocus(g, focus, s, tc), cells = tc.view(s.p, s.q, s.cellScale);
    const { shown } = blendShown(L.pos, M_ID, null, 1);
    const c = screen({ x: 0, y: 0 });
    assert.equal(hitTest(shown, c.px, c.py, s, cells, f), focus, style + " center");
    const other = L.T.nodes[3].key, o = screen(shown.get(other)!);
    assert.equal(hitTest(shown, o.px, o.py, s, cells, f), other, style + " other");
  }
  const s = DEFAULT_SETTINGS, L = layoutFocus(g, focus, s, tc);
  assert.equal(hitTest(blendShown(L.pos, M_ID, null, 1).shown, 1, 1, s, tc.view(7, 3, 1), f), null, "outside the disk");
});

test("blend: geodesic path, far notes fade out and in, new notes fade in", () => {
  const near = { x: 0.3, y: 0 }, nearFrom = { x: -0.3, y: 0 };
  const far = { x: 0.95, y: 0 }, farFrom = { x: -0.95, y: 0 };
  const pos = new Map<number, { x: number; y: number }>([[1, near], [2, far], [3, { x: 0, y: 0.5 }]]);
  const from = new Map([[1, nearFrom], [2, farFrom]]);
  assert.ok(hdist(farFrom, far) > FAR && hdist(nearFrom, near) < FAR);
  const at = (e: number) => blendShown(pos, M_ID, from, e);
  assert.deepEqual(at(0).shown.get(1), nearFrom);
  const mid = at(0.5).shown.get(1)!;
  assert.ok(Math.abs(hdist(nearFrom, mid) - hdist(mid, near)) < 1e-9, "halfway along the geodesic");
  assert.deepEqual(at(0.25).shown.get(2), farFrom, "far note stays put while fading out");
  assert.ok(Math.abs(at(0.25).alpha.get(2)! - 0.5) < 1e-9);
  assert.deepEqual(at(0.75).shown.get(2), far, "then fades in at the new place");
  assert.ok(Math.abs(at(0.75).alpha.get(2)! - 0.5) < 1e-9);
  assert.equal(at(0.4).alpha.get(3), 0.4, "new note fades in");
  assert.equal(at(1).alpha.size, 0);
  assert.deepEqual(at(1).shown.get(1), near);
});

test("geoLerp ends at both points; bestRotation recovers a rotation", () => {
  const a = { x: 0.2, y: -0.6 }, b = { x: -0.5, y: 0.4 };
  const e0 = geoLerp(a, b, 0), e1 = geoLerp(a, b, 1);
  assert.ok(hdist(e0, a) < 1e-9 && hdist(e1, b) < 1e-9);
  const g = genGraph(800, 2, 7), L = layoutFocus(g, mostLinked(g), DEFAULT_SETTINGS, new TilingCache());
  for (const th of [0.7, -2.1, 3]) {
    const R = rotation(th), from = new Map([...L.pos].map(([k, z]) => [k, mApply(R, z)]));
    const got = bestRotation(L.pos, from);
    assert.ok(Math.abs(Math.atan2(Math.sin(got - th), Math.cos(got - th))) < 1e-9, `θ ${th} → ${got}`);
  }
});
