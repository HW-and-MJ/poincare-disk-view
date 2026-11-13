// Poincaré disk geometry (curvature −1). Ported from prototype/hyperbolic-focus.html CORE.

export interface C { x: number; y: number }
/** Disk automorphism f(z) = (a z + b) / (conj(b) z + conj(a)). */
export interface Mobius { a: C; b: C }

export const ZERO: C = { x: 0, y: 0 };
const ONE: C = { x: 1, y: 0 };

export const add = (a: C, b: C): C => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: C, b: C): C => ({ x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x });
export const conj = (a: C): C => ({ x: a.x, y: -a.y });
export const neg = (a: C): C => ({ x: -a.x, y: -a.y });
export const div = (a: C, b: C): C => {
  const d = b.x * b.x + b.y * b.y;
  return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
};
export const abs2 = (a: C) => a.x * a.x + a.y * a.y;
/** Angle wrapped into [−π, π). */
export const wrap = (x: number) => ((x + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

export const M_ID: Mobius = { a: ONE, b: ZERO };
export const mApply = (m: Mobius, z: C): C => div(add(mul(m.a, z), m.b), add(mul(conj(m.b), z), conj(m.a)));
export const mMul = (m: Mobius, n: Mobius): Mobius => ({
  a: add(mul(m.a, n.a), mul(m.b, conj(n.b))),
  b: add(mul(m.a, n.b), mul(m.b, conj(n.a))),
});
export const mNorm = (m: Mobius): Mobius => {
  const k = Math.sqrt(abs2(m.a) - abs2(m.b));
  return { a: { x: m.a.x / k, y: m.a.y / k }, b: { x: m.b.x / k, y: m.b.y / k } };
};
/** Moves a to the origin. */
export const toOrigin = (a: C): Mobius => ({ a: ONE, b: neg(a) });
/** Moves the origin to a. */
export const fromOrigin = (a: C): Mobius => ({ a: ONE, b: a });

export const distFromOrigin = (z: C) => 2 * Math.atanh(Math.min(Math.sqrt(abs2(z)), 0.999999));
export const polar = (r: number, th: number): C => {
  const s = Math.tanh(r / 2);
  return { x: s * Math.cos(th), y: s * Math.sin(th) };
};
export function hdist(u: C, v: C) {
  const du = 1 - abs2(u), dv = 1 - abs2(v);
  return Math.acosh(1 + 2 * ((u.x - v.x) ** 2 + (u.y - v.y) ** 2) / (du * dv));
}
/** Point at fraction t of the way from the origin to a, along the geodesic. */
export function along(a: C, t: number): C {
  const r = distFromOrigin(a);
  return r === 0 ? ZERO : polar(t * r, Math.atan2(a.y, a.x));
}

/** Circle of the geodesic through u and v (orthogonal to the unit circle), or null when it is a straight line. */
export function geodesicCircle(u: C, v: C): { c: C; r: number } | null {
  const cross = u.x * v.y - u.y * v.x;
  if (Math.abs(cross) < 1e-9) return null;
  const pu = (abs2(u) + 1) / 2, pv = (abs2(v) + 1) / 2;
  const c = { x: (pu * v.y - pv * u.y) / cross, y: (pv * u.x - pu * v.x) / cross };
  const r2 = abs2(c) - 1;
  // Points stuck to the boundary give no circle through rounding; draw a straight line instead.
  if (!(r2 > 0) || !Number.isFinite(r2)) return null;
  return { c, r: Math.sqrt(r2) };
}

/** Reflection of z in the geodesic through a and b. */
export function reflect(z: C, a: C, b: C): C {
  const g = geodesicCircle(a, b);
  if (!g) {
    const d = abs2(a) > abs2(b) ? a : b, l = Math.sqrt(abs2(d)), ux = d.x / l, uy = d.y / l;
    const dot = z.x * ux + z.y * uy;
    return { x: 2 * dot * ux - z.x, y: 2 * dot * uy - z.y };
  }
  const dx = z.x - g.c.x, dy = z.y - g.c.y, k = (g.r * g.r) / (dx * dx + dy * dy);
  return { x: g.c.x + k * dx, y: g.c.y + k * dy };
}

/** Multiplies the hyperbolic distance from the origin by lam, keeping the direction. */
export const scaleRadial = (z: C, lam: number): C =>
  abs2(z) < 1e-24 ? ZERO : polar(lam * distFromOrigin(z), Math.atan2(z.y, z.x));
