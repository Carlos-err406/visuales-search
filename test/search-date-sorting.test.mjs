import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseLibraryDate, mergeLibraryEntry } from "../packages/core/dist/library-date.js";
import { buildSearchTree } from "../packages/core/dist/search-tree.js";

let home, index, cache, discovery, search, parseDirectoryListing, listingEntries;
const base = "https://visuales.uclv.cu/";
const entry = (name, modifiedLocal, modifiedCheckedAt = 100) => ({
  text: name.replace(/\/$/, "").split("/").at(-1),
  url: base + name,
  encodedUrl: base + name,
  directory: "",
  isDirectoryLink: name.endsWith("/"),
  ...(modifiedLocal ? { modifiedLocal, modifiedCheckedAt } : {}),
});
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-sort-"));
  process.env.HOME = process.env.USERPROFILE = home;
  ({ parseDirectoryListing, listingEntries } = await import("../packages/core/dist/library-listing.js"));
  index = await import("../packages/core/dist/search-file-index.js");
  cache = await import("../packages/core/dist/lib/cache.js");
  discovery = await import("../packages/core/dist/download/discovery-cache.js");
  search = await import("../packages/core/dist/search.js");
});
after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

test("Apache minutes normalize independently of the client timezone without inventing dates", () => {
  assert.equal(parseLibraryDate("2026-09-18 11:06"), "2026-09-18T11:06");
  assert.equal(parseLibraryDate("18-Sep-2026 11:06"), "2026-09-18T11:06");
  assert.equal(parseLibraryDate("2024-02-29T23:59"), "2024-02-29T23:59");
  for (const value of [
    null,
    42,
    "",
    "-",
    "2026-02-29 10:00",
    "2026-13-01 10:00",
    "2026-00-01 10:00",
    "2026-01-00 10:00",
    "2026-09-18 24:00",
    "2026-09-18 10:60",
    "18-Bad-2026 10:00",
    "2026-09-18T11:06Z",
  ])
    assert.equal(parseLibraryDate(value), undefined, String(value));
  const module = new URL("../packages/core/dist/library-date.js", import.meta.url).href;
  for (const TZ of ["UTC", "America/New_York", "Pacific/Auckland"])
    assert.equal(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { parseLibraryDate } from ${JSON.stringify(module)}; console.log(parseLibraryDate("2026-03-08 02:30"));`,
        ],
        { env: { ...process.env, TZ }, encoding: "utf8" }
      ).trim(),
      "2026-03-08T02:30"
    );
});

test("table and pre listings retain dates for files and folders without changing size trust", () => {
  const listing = parseDirectoryListing(
    `<table>
    <tr><th><a href="?C=M;O=A">Last modified</a></th></tr>
    <tr><td></td><td><a href="Part%201%20(2026)/">Part 1</a></td><td>2026-09-18 11:06</td><td>-</td></tr>
    <tr><td></td><td><a href="notes.txt">notes.txt</a></td><td>2026-09-17 10:00</td><td>42</td></tr>
    <tr><td></td><td><a href="film.mkv">film.mkv</a></td><td>-</td><td>1.8G</td></tr>
    </table>`,
    base
  );
  const entries = listingEntries(base, { ...listing, fetchedAt: 123 });
  assert.equal(entries[0].encodedUrl, base + "Part%201%20(2026)/");
  assert.equal(entries[0].modifiedLocal, "2026-09-18T11:06");
  assert.equal(entries[1].modifiedLocal, "2026-09-17T10:00");
  assert.equal(entries[2].modifiedLocal, undefined);
  assert.ok(entries.every((item) => item.modifiedCheckedAt === 123));
  assert.equal(listing.files[0].exact, true);
  assert.equal(listing.files[1].exact, false);
  const pre = parseDirectoryListing(
    '<pre><a href="../">Parent</a>\n<a href="Extras/">Extras</a> 18-Sep-2026 10:00 -\n<a href="2026-09-18.txt">2026-09-18 11:00</a> - 42\n<a href="notes.txt">Notes</a> 2026-09-17 12:00 42\n</pre>',
    base
  );
  assert.equal(listingEntries(base, pre)[0].modifiedLocal, "2026-09-18T10:00");
  assert.equal(listingEntries(base, pre)[1].modifiedLocal, undefined);
  assert.equal(listingEntries(base, pre)[2].modifiedLocal, "2026-09-17T12:00");
  assert.equal(pre.files[1].size, 42);
});

test("sorts siblings by dates, folders first and unknown dates last in both directions", () => {
  const entries = [
    entry("Z/", "2026-09-18T10:00"),
    entry("A/", "2026-09-17T10:00"),
    entry("Undated/"),
    entry("A/Child/", "2026-09-19T10:00"),
    entry("one.txt", "2026-09-17T10:00"),
    entry("two.txt", "2026-09-18T10:00"),
    entry("unknown.txt"),
    entry("invalid.txt", "yesterday"),
  ];
  const names = (sort) => buildSearchTree(entries, sort).map((item) => item.name);
  assert.deepEqual(names("name-asc"), ["A", "Undated", "Z", "invalid.txt", "one.txt", "two.txt", "unknown.txt"]);
  assert.deepEqual(names("name-desc"), ["Z", "Undated", "A", "unknown.txt", "two.txt", "one.txt", "invalid.txt"]);
  assert.deepEqual(names("modified-desc"), ["Z", "A", "Undated", "two.txt", "one.txt", "invalid.txt", "unknown.txt"]);
  assert.deepEqual(names("modified-asc"), ["A", "Z", "Undated", "one.txt", "two.txt", "invalid.txt", "unknown.txt"]);
  assert.deepEqual(
    buildSearchTree([entry("Part10/", "2026-09-18T10:00"), entry("Part2/", "2026-09-18T10:00")], "modified-desc").map(
      (item) => item.name
    ),
    ["Part2", "Part10"]
  );
  assert.equal(buildSearchTree(entries, "modified-desc")[1].children[0].name, "Child");
});

test("newest metadata wins over stale results; a newer missing date clears the old one", () => {
  const dated = entry("Movie/", "2026-09-18T10:00", 200);
  const old = entry("Movie/", "2026-09-17T10:00", 100);
  assert.equal(mergeLibraryEntry(dated, old).modifiedLocal, dated.modifiedLocal);
  assert.equal(mergeLibraryEntry(old, dated).modifiedLocal, dated.modifiedLocal);
  assert.equal(mergeLibraryEntry(dated, entry("Movie/")).modifiedLocal, dated.modifiedLocal);
  const missing = { ...entry("Movie/"), modifiedCheckedAt: 300 };
  assert.equal(mergeLibraryEntry(dated, missing).modifiedLocal, undefined);
  assert.equal(mergeLibraryEntry(missing, dated).modifiedLocal, undefined);
});

test("date backfill orders inferred ancestors without adding unrelated rows or changing selection targets", () => {
  const results = [entry("Alpha/match.txt"), entry("Zulu/match.txt")];
  const metadata = new Map([
    [base + "Alpha/", entry("Alpha/", "2026-09-17T10:00")],
    [base + "Zulu/", entry("Zulu/", "2026-09-18T10:00")],
    [base + "Unrelated/", entry("Unrelated/", "2026-09-19T10:00")],
  ]);
  const tree = buildSearchTree(results, "modified-desc", metadata);
  assert.deepEqual(
    tree.map((node) => node.name),
    ["Zulu", "Alpha"]
  );
  assert.equal(tree[0].entry, undefined);
  assert.equal(tree[0].modifiedCheckedAt, 100);
  assert.equal(tree[0].children[0].entry, results[1]);
});

test("discovery round trips dates without downgrading exact sizes or legacy records", async () => {
  const url = `${base}Cache/`;
  const listing = {
    files: [{ url: url + "file.txt", size: 1000, exact: true }],
    dirs: [],
    fetchedAt: 100,
    parserVersion: discovery.DIRECTORY_LISTING_PARSER_VERSION,
    modified: { [url + "file.txt"]: "2026-09-18T11:06" },
  };
  await cache.setDiscoveryCache({ [url]: listing, [base + "Legacy/"]: { files: [], dirs: [] } });
  await discovery.loadDiscoveryCache();
  assert.deepEqual(discovery.dirListingCache.get(url).modified, listing.modified);
  assert.equal(discovery.getCachedFileSizeInfo(url + "file.txt").exact, true);
  assert.equal(listingEntries(base + "Legacy/", discovery.dirListingCache.get(base + "Legacy/")).length, 0);
  discovery.dirListingCache.set(url, { ...listing, fetchedAt: 200 });
  await discovery.saveDiscoveryCache();
  discovery.dirListingCache.clear();
  await discovery.loadDiscoveryCache();
  assert.equal(listingEntries(url, discovery.dirListingCache.get(url))[0].modifiedCheckedAt, 200);
  assert.deepEqual(discovery.dirListingCache.get(url).modified, listing.modified);
});

test("indexed dates enrich empty, matching and scoped searches without flattening unrelated files", async () => {
  await index.clearFileIndex();
  const parent = `${base}Sort/`;
  const child = parent + "Film/";
  await cache.setCachedHtml(`<a href="${parent}">Sort</a><a href="${child}">Film</a>`);
  await index.publishIndexedDirectory(
    parent,
    { files: [{ url: parent + "unrelated.mkv", size: 42 }], dirs: [child], modified: { [child]: "2026-09-18T10:00" } },
    100
  );
  await index.publishIndexedDirectory(
    child,
    {
      files: [{ url: child + "movie.mkv", size: 42 }],
      dirs: [],
      modified: { [child + "movie.mkv"]: "2026-09-17T10:00" },
    },
    100
  );
  const empty = await search.searchContent([]);
  assert.deepEqual(
    empty.results.map((item) => item.encodedUrl),
    [parent, child]
  );
  assert.equal(empty.results[1].modifiedLocal, "2026-09-18T10:00");
  const matched = await search.searchContent(["movie"]);
  assert.equal(matched.results[0].modifiedLocal, "2026-09-17T10:00");
  assert.equal(matched.allResults.find((item) => item.encodedUrl === child).modifiedLocal, "2026-09-18T10:00");
  const scoped = await search.searchContent([], { root: child });
  assert.deepEqual(
    scoped.results.map((item) => item.encodedUrl),
    [child + "movie.mkv"]
  );
  const firstRevision = matched.indexRevision;
  await index.publishIndexedDirectory(parent, { files: [], dirs: [child], modified: {} }, 200);
  assert.equal(
    await index.publishIndexedDirectory(
      parent,
      { files: [], dirs: [child], modified: { [child]: "2026-09-19T10:00" } },
      150
    ),
    false
  );
  const refreshed = await search.searchContent([]);
  assert.notEqual(refreshed.indexRevision, firstRevision);
  assert.equal(refreshed.results[1].modifiedLocal, undefined);
  assert.equal(refreshed.results[1].modifiedCheckedAt, 200);
  assert.equal((await index.cachedIndexedDirectory(child)).entries[0].modifiedCheckedAt, 100);
});
