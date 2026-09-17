import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";

let home, index, cache;
const base = "https://visuales.uclv.cu";
const listing = (url, names) => ({ files: names.map((name) => ({ url: url + name, size: 42 })), dirs: [] });
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-index-"));
  process.env.HOME = process.env.USERPROFILE = home;
  index = await import("../packages/core/dist/search-file-index.js");
  cache = await import("../packages/core/dist/lib/cache.js");
});
after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

test("imports known files without inventing freshness and fresh empty snapshots beat legacy data", async () => {
  const url = `${base}/Recientes/`;
  await cache.setDiscoveryCache({ [url]: listing(url, ["old.mkv"]), broken: {} });
  let catalog = await index.readFileIndex();
  assert.equal(catalog.directories.get(url).fetchedAt, 0);
  assert.equal(catalog.directories.get(url).entries[0].text, "old.mkv");
  await index.publishIndexedDirectory(url, listing(url, []), 100);
  await cache.setDiscoveryCache({ [url]: listing(url, ["old.mkv", "stale.mkv"]) });
  catalog = await index.readFileIndex();
  assert.deepEqual(catalog.directories.get(url).entries, []);
  assert.equal(await index.publishIndexedDirectory(url, listing(url, ["late.mkv"]), 99), false);
});

test("generation clearing rejects late writers; a removed child fences old requests", async () => {
  const url = `${base}/Parent/`,
    child = `${url}Child/`;
  const generation = await index.fileIndexGeneration();
  await index.publishIndexedDirectory(url, { files: [], dirs: [child] }, 100, generation);
  await index.publishIndexedDirectory(child, listing(child, ["film.mkv"]), 101, generation);
  await index.publishIndexedDirectory(url, listing(url, []), 200, generation);
  assert.equal(await index.cachedIndexedDirectory(child), undefined);
  assert.equal(await index.publishIndexedDirectory(child, listing(child, ["late.mkv"]), 150, generation), false);
  await index.clearFileIndex();
  assert.equal(await index.publishIndexedDirectory(url, listing(url, ["late.mkv"]), 300, generation), false);
});

test("independent processes publish without losing records, and invalid links stay outside the index", async () => {
  const module = new URL("../packages/core/dist/search-file-index.js", import.meta.url).href;
  const children = Array.from({ length: 4 }, (_, n) =>
    spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    const m = await import(${JSON.stringify(module)});
    await m.publishIndexedDirectory(${JSON.stringify(`${base}/Concurrent${n}/`)}, ${JSON.stringify(listing(`${base}/Concurrent${n}/`, ["file.txt"]))}, 400);
  `,
      ],
      { env: process.env, stdio: "pipe" }
    )
  );
  const results = await Promise.all(children.map((child) => once(child, "exit")));
  for (const [code] of results) assert.equal(code, 0);
  const catalog = await index.readFileIndex();
  for (let n = 0; n < 4; n++) assert.ok(catalog.directories.has(`${base}/Concurrent${n}/`));
  await index.publishIndexedDirectory(
    `${base}/Safe/`,
    {
      files: [
        { url: "https://evil.test/a", size: 1 },
        { url: `${base}/Outside/file.txt`, size: 1 },
      ],
      dirs: [],
    },
    500
  );
  assert.deepEqual((await index.cachedIndexedDirectory(`${base}/Safe/`)).entries, []);
});

test("a corrupt directory record does not discard healthy directories or folder search", async () => {
  const url = `${base}/Corrupt/`;
  await index.publishIndexedDirectory(url, listing(url, ["file.mkv"]), 600);
  const file = path.join(
    index.fileIndexDirectory(),
    "directories",
    `${createHash("sha256").update(url).digest("hex")}.json`
  );
  await fs.writeFile(file, "{broken");
  const catalog = await index.readFileIndex();
  assert.equal(catalog.directories.has(url), false);
  assert.ok(catalog.directories.has(`${base}/Concurrent0/`));
  await cache.setCachedHtml(`<a href="${base}/Folder/">Folder</a>`);
  const { searchContent } = await import("../packages/core/dist/search.js");
  assert.equal((await searchContent(["Folder"])).results.length, 1);
});

test("dirty discovery writes merge without restoring removed files or overwriting newer listings", async () => {
  const discovery = await import("../packages/core/dist/download/discovery-cache.js");
  const first = `${base}/Dirty/`,
    second = `${base}/OtherProcess/`;
  await cache.setDiscoveryCache({ [first]: { ...listing(first, ["gone.bin", "kept.bin"]), fetchedAt: 10 } });
  discovery.dirListingCache.clear();
  await discovery.loadDiscoveryCache();
  discovery.updateCachedFileSize(`${first}gone.bin`, 9999);
  await cache.setDiscoveryCache({
    [first]: { ...listing(first, ["kept.bin"]), fetchedAt: 20 },
    [second]: listing(second, ["new.bin"]),
  });
  await discovery.saveDiscoveryCache();
  const data = await cache.getDiscoveryCache();
  assert.deepEqual(
    data[first].files.map((file) => file.url),
    [`${first}kept.bin`]
  );
  assert.equal(data[first].fetchedAt, 20);
  assert.equal(data[second].files.length, 1);
});
