import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchTree,
  distinctDownloadUrls,
  treeSelectionStates,
  changeTreeSelection,
} from "../packages/core/dist/search-tree.js";

const entry = (path, text = "") => ({
  encodedUrl: `https://visuales.uclv.cu${path}`,
  url: `https://visuales.uclv.cu${path}`,
  text,
  directory: "",
  isDirectoryLink: path.endsWith("/"),
});
test("index and live-listing URL spellings identify the same folder and descendants", () => {
  const tree = buildSearchTree([
    entry("/Movies/2013/2%20Guns%20(2013)/"),
    entry("/Movies/2013/2%20Guns%20%282013%29/"),
    entry("/Movies/2013/2%20Guns%20%282013%29/notes.txt"),
    entry("/Movies/2013/%32%20Guns%20(2013)/notes.txt"),
  ]);
  const year = tree[0].children[0];
  assert.equal(year.children.length, 1);
  assert.equal(year.children[0].children.length, 1);
  assert.equal(year.children[0].url, entry("/Movies/2013/2%20Guns%20(2013)/").encodedUrl);
  const distinct = buildSearchTree([entry("/a%2fb/"), entry("/a%2Fb/"), entry("/a/b/"), entry("/a%252Fb/")]);
  assert.equal(distinct.length, 3, "escaped separators and literal percent escapes stay distinct");
});
test("tree groups encoded paths, promotes real folders, deduplicates and sorts without merging hosts", () => {
  const file = entry("/Movies/Part%201/notes.txt");
  const tree = buildSearchTree([file, entry("/Movies/Part%201/", "Part One"), file, entry("/Movies/clip.mp4")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].entry, undefined);
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[0].children[0].name, "Part One");
  assert.equal(tree[0].children[0].children.length, 1);
  assert.equal(tree[0].children[0].children[0].parent, "https://visuales.uclv.cu/Movies/Part%201/");
  assert.equal(buildSearchTree([entry("/a%2Fb/child.txt")])[0].children.length, 1);
});
test("overlapping parent/child selections produce only distinct download targets", () => {
  const parent = entry("/Movies/Part%201/").encodedUrl;
  assert.deepEqual(
    distinctDownloadUrls([
      parent,
      `${parent}notes.txt`,
      `${parent}Extra/`,
      parent,
      entry("/Movies/Part%202/").encodedUrl,
    ]),
    [parent, entry("/Movies/Part%202/").encodedUrl]
  );
});

const folder = entry("/Library/Album/").encodedUrl;
const first = `${folder}Disc%201/`;
const track = `${first}track.mp3`;
const second = `${folder}Disc%202/`;
const other = entry("/Library/Other/").encodedUrl;
const selectionTree = () =>
  buildSearchTree([
    entry("/Library/Album/"),
    entry("/Library/Album/Disc%201/"),
    entry("/Library/Album/Disc%201/track.mp3"),
    entry("/Library/Album/Disc%202/"),
    entry("/Library/Other/"),
  ]);

test("checking a folder selects its nested children and emits one download target", () => {
  const tree = selectionTree();
  const selected = changeTreeSelection(tree, new Set(), new Set([folder]), true);
  const states = treeSelectionStates(tree, selected);
  for (const url of [folder, first, track, second]) assert.equal(states.get(url), true);
  assert.equal(states.get(other), false);
  assert.deepEqual(distinctDownloadUrls(selected), [folder]);
  assert.equal(changeTreeSelection(tree, selected, new Set([folder]), false).size, 0);
});

test("partial selection is indeterminate at every ancestor and complete children check the parent", () => {
  const tree = selectionTree();
  const selected = new Set([track]);
  let states = treeSelectionStates(tree, selected);
  assert.equal(states.get(first), true);
  assert.equal(states.get(folder), "indeterminate");
  assert.equal(states.get("https://visuales.uclv.cu/Library/"), "indeterminate");
  selected.add(second);
  states = treeSelectionStates(tree, selected);
  assert.equal(states.get(folder), true);
  assert.deepEqual(
    distinctDownloadUrls(selected),
    [track, second],
    "derived parent state does not broaden download scope"
  );
});

test("excluding a nested child splits selected ancestors without losing siblings", () => {
  const tree = selectionTree();
  const selected = changeTreeSelection(tree, new Set([folder, other]), new Set([track]), false);
  assert.deepEqual([...selected].sort(), [second, other].sort());
  const states = treeSelectionStates(tree, selected);
  assert.equal(states.get(track), false);
  assert.equal(states.get(first), false);
  assert.equal(states.get(folder), "indeterminate");
  assert.deepEqual(distinctDownloadUrls(selected).sort(), [second, other].sort());
});

test("newly discovered children inherit explicit folder selection, not derived parent checks", () => {
  const tree = selectionTree();
  const nextTree = buildSearchTree([
    entry("/Library/Album/"),
    entry("/Library/Album/Disc%201/"),
    entry("/Library/Album/Disc%201/track.mp3"),
    entry("/Library/Album/Disc%202/"),
    entry("/Library/Album/new.txt"),
  ]);
  const selected = changeTreeSelection(tree, new Set(), new Set([folder]), true);
  assert.equal(treeSelectionStates(nextTree, selected).get(`${folder}new.txt`), true);
  const partial = treeSelectionStates(nextTree, new Set([first, second]));
  assert.equal(partial.get(`${folder}new.txt`), false);
  assert.equal(partial.get(folder), "indeterminate");
});

test("range targets cascade and deselect without affecting unrelated branches", () => {
  const tree = selectionTree();
  const selected = changeTreeSelection(tree, new Set([other]), new Set([first, second]), true);
  assert.equal(treeSelectionStates(tree, selected).get(folder), true);
  const cleared = changeTreeSelection(tree, selected, new Set([first, second]), false);
  assert.deepEqual([...cleared], [other]);
});

test("large index selections collapse into distinct targets without confusing encoded names or hosts", () => {
  const nested = Array.from({ length: 30000 }, (_, index) => `${folder}${index}/track.mp3`);
  assert.deepEqual(distinctDownloadUrls([...nested, folder]), [folder]);
  assert.deepEqual(
    distinctDownloadUrls([
      folder,
      `${folder}child/`,
      `${folder.slice(0, -1)}%2Ffile.txt`,
      "https://other.example/Library/Album/",
    ]),
    [folder, `${folder.slice(0, -1)}%2Ffile.txt`, "https://other.example/Library/Album/"]
  );
});
