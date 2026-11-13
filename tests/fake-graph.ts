// Fake vault graph for tests and measurements (from the prototype's genGraph).
// Preferential attachment makes hubs; closing triangles makes clusters.
import { addEdge, type Graph } from "../src/graph.ts";

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["Hyperbolic", "Graph", "Memory", "Attention", "Neuron", "Cortex", "Topology", "Curvature", "Manifold", "Tensor",
  "Gradient", "Entropy", "Language", "Syntax", "Vision", "Kernel", "Cache", "Network", "Protocol", "Ethics", "History", "Poetry",
  "Music", "Rhythm", "Biology", "Cell", "Gene", "Protein", "Climate", "Ocean", "Market", "Habit", "Sleep", "Focus", "Project", "Idea"];
export const FOLDERS = ["Research", "Projects", "Daily", "Reading", "Ideas"], TAGS = ["#idea", "#todo", "#paper", "#people"];

export function genGraph(n: number, m: number, seed: number): Graph {
  const r = rng(seed), ends: number[] = [], folder: string[] = new Array(n);
  const names = Array.from({ length: n }, (_, i) => WORDS[i % WORDS.length] + " " + i);
  const g: Graph = { names, paths: new Array(n), tags: new Array(n), adj: names.map(() => new Map()), index: new Map() };
  for (let i = 0; i <= m && i < n; i++) for (let j = 0; j < i; j++) { addEdge(g, i, j); ends.push(i, j); }
  for (let i = m + 1; i < n; i++) {
    const picked = new Set<number>();
    for (let guard = 0; picked.size < m && guard < 50; guard++) {
      let t: number;
      if (picked.size && r() < 0.5) {
        const p = [...picked][Math.floor(r() * picked.size)], nb = [...g.adj[p].keys()];
        t = nb[Math.floor(r() * nb.length)];
      } else t = ends[Math.floor(r() * ends.length)];
      if (t < i) picked.add(t);
    }
    for (const t of picked) { addEdge(g, i, t); ends.push(i, t); }
  }
  // 60% of notes take the folder of a note they link to, so folders roughly follow clusters.
  for (let i = 0; i < n; i++) {
    const nb = [...g.adj[i].keys()].filter((j) => j < i);
    folder[i] = nb.length && r() < 0.6 ? folder[nb[Math.floor(r() * nb.length)]] : FOLDERS[Math.floor(r() * FOLDERS.length)];
    g.paths[i] = folder[i] + "/" + names[i] + ".md";
    g.index.set(g.paths[i], i);
    g.tags[i] = r() < 0.4 ? [TAGS[Math.floor(r() * TAGS.length)]] : [];
  }
  return g;
}

export const mostLinked = (g: Graph) => {
  let best = 0;
  g.adj.forEach((a, i) => { if (a.size > g.adj[best].size) best = i; });
  return best;
};
