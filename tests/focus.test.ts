import { test } from "node:test";
import assert from "node:assert/strict";
import { canFocus, degrees, mostConnected, pickInitialFocus } from "../src/focus.ts";
import { graphFromLinks } from "../src/graph.ts";

const links = {
  "a.md": { "hub.md": 1, "b.md": 2 },
  "b.md": { "hub.md": 1, "a.md": 1 },
  "c.md": { "hub.md": 3 },
  "hub.md": { "d.md": 1, "hub.md": 1 },
  "d.md": {},
};
const notes = new Set(Object.keys(links));
const isNote = (p: string) => notes.has(p);

test("degree counts distinct neighbors in both directions, ignoring self links", () => {
  const d = degrees(links);
  assert.equal(d.get("hub.md"), 4);
  assert.equal(d.get("a.md"), 2);
  assert.equal(d.get("d.md"), 1);
});

test("most connected note, ties broken by path", () => {
  assert.equal(mostConnected(links, isNote), "hub.md");
  assert.equal(mostConnected({ "y.md": { "z.md": 1 } }, () => true), "y.md");
  assert.equal(mostConnected({}, isNote), null);
});

test("recent note wins; missing or non-note recents are skipped", () => {
  assert.equal(pickInitialFocus(["c.md", "a.md"], links, isNote), "c.md");
  assert.equal(pickInitialFocus([null, "gone.md", "pic.png", "b.md"], links, isNote), "b.md");
  assert.equal(pickInitialFocus([], links, isNote), "hub.md");
});

test("orphans cannot be the focus unless shown", () => {
  const g = graphFromLinks({ "a.md": { "b.md": 1 } }, { "a.md": [], "b.md": [], "lonely.md": [] });
  assert.equal(canFocus(g, "a.md", false), true);
  assert.equal(canFocus(g, "b.md", false), true, "linked to, no outgoing links");
  assert.equal(canFocus(g, "lonely.md", false), false);
  assert.equal(canFocus(g, "lonely.md", true), true);
  assert.equal(canFocus(g, "missing.md", true), false);
  assert.equal(canFocus(null, "lonely.md", false), true, "unknown before the graph is built");
});
