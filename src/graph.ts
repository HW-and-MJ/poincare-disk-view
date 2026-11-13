// Note graph, focus distance (OPD-D03 draft) and the focus tree. Ported from the prototype CORE.
import type { LinkMap } from "./focus.ts";

export interface Graph {
  names: string[];
  paths: string[];
  tags: string[][];
  /** Undirected adjacency with link counts summed over both directions. */
  adj: Map<number, number>[];
  index: Map<string, number>;
}

export function addEdge(g: Graph, a: number, b: number, w = 1) {
  if (a === b) return;
  g.adj[a].set(b, (g.adj[a].get(b) || 0) + w);
  g.adj[b].set(a, (g.adj[b].get(a) || 0) + w);
}

export const noteName = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

/**
 * Builds the graph from `metadataCache.resolvedLinks`. Every key of `tags` becomes a node even without links,
 * so passing all notes there keeps orphan notes. Paths rejected by `keep` (e.g. attachments) are dropped.
 */
export function graphFromLinks(
  links: LinkMap,
  tags: Record<string, string[]> = {},
  keep: (path: string) => boolean = () => true,
): Graph {
  const index = new Map<string, number>(), paths: string[] = [];
  const id = (p: string) => {
    let i = index.get(p);
    if (i === undefined) { i = paths.length; index.set(p, i); paths.push(p); }
    return i;
  };
  const pairs: [number, number, number][] = [];
  for (const p of Object.keys(tags)) if (keep(p)) id(p);
  for (const [src, dsts] of Object.entries(links)) {
    if (!keep(src)) continue;
    const s = id(src);
    for (const [d, c] of Object.entries(dsts || {})) if (keep(d)) pairs.push([s, id(d), +c || 1]);
  }
  const g: Graph = {
    names: paths.map(noteName),
    paths,
    tags: paths.map((p) => tags[p] || []),
    adj: paths.map(() => new Map()),
    index,
  };
  for (const [a, b, w] of pairs) addEdge(g, a, b, w);
  return g;
}

export interface TreeParams { maxHop: number; hub: number; maxKids: number }

/** Notes are keyed by graph index; a bundle of children cut by maxKids is keyed "agg<parent>". */
export type NodeKey = number | string;
export interface TreeNode {
  key: NodeKey;
  /** Graph index, or −1 for a bundle node. */
  id: number;
  parent: TreeNode | null;
  d: number;
  hop: number;
  /** Notes this node stands for (more than 1 only for bundles). */
  count: number;
  children: TreeNode[];
}
export interface FocusTree {
  nodes: TreeNode[];
  byKey: Map<NodeKey, TreeNode>;
  dist: Float64Array;
  hop: Int32Array;
  reached: number;
  collapsed: number;
}

type HeapItem = [number, number];
function heapPush(h: HeapItem[], x: HeapItem) {
  h.push(x);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function heapPop(h: HeapItem[]): HeapItem {
  const top = h[0], last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

/** Hop-based distance with a penalty for entering hubs and a bonus for repeated links. */
export function shortest(g: Graph, src: number, P: TreeParams) {
  const n = g.names.length;
  const dist = new Float64Array(n).fill(Infinity), hop = new Int32Array(n).fill(-1), par = new Int32Array(n).fill(-1);
  let maxDeg = 1;
  for (const a of g.adj) if (a.size > maxDeg) maxDeg = a.size;
  const lnMax = Math.log(1 + maxDeg);
  dist[src] = 0;
  hop[src] = 0;
  const h: HeapItem[] = [[0, src]];
  while (h.length) {
    const [d, u] = heapPop(h);
    if (d > dist[u] || hop[u] >= P.maxHop) continue;
    for (const [v, w] of g.adj[u]) {
      const nd = d + (1 + (P.hub * Math.log(1 + g.adj[v].size)) / lnMax) / (1 + 0.5 * Math.log(w));
      if (nd < dist[v]) { dist[v] = nd; par[v] = u; hop[v] = hop[u] + 1; heapPush(h, [nd, v]); }
    }
  }
  return { dist, hop, par };
}

/** Shortest-path tree rooted at the focus. Children beyond maxKids are bundled into one node. */
export function buildTree(g: Graph, focus: number, P: TreeParams): FocusTree {
  const { dist, hop, par } = shortest(g, focus, P);
  const kids = new Map<number, number[]>();
  for (let v = 0; v < dist.length; v++) {
    if (par[v] < 0) continue;
    if (!kids.has(par[v])) kids.set(par[v], []);
    kids.get(par[v])!.push(v);
  }
  const root: TreeNode = { key: focus, id: focus, parent: null, d: 0, hop: 0, count: 1, children: [] };
  const nodes = [root], stack = [root];
  let collapsed = 0;
  while (stack.length) {
    const nd = stack.pop()!;
    const ch = (kids.get(nd.id) || []).sort((a, b) => dist[a] - dist[b]);
    for (const c of ch.slice(0, P.maxKids)) {
      const cn: TreeNode = { key: c, id: c, parent: nd, d: dist[c], hop: hop[c], count: 1, children: [] };
      nd.children.push(cn);
      nodes.push(cn);
      stack.push(cn);
    }
    const rest = ch.slice(P.maxKids);
    if (rest.length) {
      let cnt = 0;
      const st = [...rest];
      while (st.length) { const x = st.pop()!; cnt++; for (const y of kids.get(x) || []) st.push(y); }
      collapsed += cnt;
      const an: TreeNode = { key: "agg" + nd.id, id: -1, parent: nd, d: dist[rest[0]], hop: nd.hop + 1, count: cnt, children: [] };
      nd.children.push(an);
      nodes.push(an);
    }
  }
  let reached = 0;
  for (const x of hop) if (x >= 0) reached++;
  return { nodes, byKey: new Map(nodes.map((n) => [n.key, n])), dist, hop, reached, collapsed };
}

export function isTreeEdge(T: FocusTree, a: number, b: number) {
  const pa = T.byKey.get(a), pb = T.byKey.get(b);
  return !!((pa && pa.parent && pa.parent.key === b) || (pb && pb.parent && pb.parent.key === a));
}
