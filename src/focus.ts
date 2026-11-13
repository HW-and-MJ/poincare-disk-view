// Choosing the note that sits at the center of the disk. No Obsidian imports, so Node can test it directly.
import type { Graph } from "./graph.ts";

export type LinkMap = Record<string, Record<string, number>>;

/** Number of distinct notes linked to or from each note (link direction ignored, same as the prototype's hop distance). */
export function degrees(links: LinkMap): Map<string, number> {
  const nbrs = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!nbrs.has(a)) nbrs.set(a, new Set());
    nbrs.get(a)!.add(b);
  };
  for (const src of Object.keys(links)) {
    for (const dst of Object.keys(links[src])) {
      if (src === dst) continue;
      add(src, dst);
      add(dst, src);
    }
  }
  const out = new Map<string, number>();
  for (const [k, s] of nbrs) out.set(k, s.size);
  return out;
}

/** The note with the most links; ties go to the alphabetically first path so the result is stable. */
export function mostConnected(links: LinkMap, isNote: (path: string) => boolean): string | null {
  let best: string | null = null;
  let bestDeg = -1;
  for (const [path, d] of degrees(links)) {
    if (!isNote(path)) continue;
    if (d > bestDeg || (d === bestDeg && best !== null && path < best)) {
      best = path;
      bestDeg = d;
    }
  }
  return best;
}

/**
 * Initial focus: the first recent note that still exists, otherwise the most connected note.
 * `recent` is ordered newest first (the active file, then workspace.getLastOpenFiles()).
 */
export function pickInitialFocus(
  recent: readonly (string | null | undefined)[],
  links: LinkMap,
  isNote: (path: string) => boolean,
): string | null {
  for (const p of recent) if (p && isNote(p)) return p;
  return mostConnected(links, isNote);
}

/**
 * Whether a note may become the focus. Orphans (no links in or out) are refused unless showOrphans.
 * Before the graph exists nothing can be checked, so everything passes and the caller re-checks later.
 */
export function canFocus(g: Graph | null, path: string, showOrphans: boolean): boolean {
  if (!g) return true;
  const i = g.index.get(path);
  if (i === undefined) return false;
  return showOrphans || g.adj[i].size > 0;
}
