import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("global and scoped searches include files, normalize separators, and retain aliases without a crawl", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-search-files-"));
  process.env.HOME = process.env.USERPROFILE = home;
  const { setCachedHtml, setDiscoveryCache, resolveSearchAlias } = await import("../packages/core/dist/lib/cache.js");
  const { searchContent } = await import("../packages/core/dist/search.js");
  const base = "https://visuales.uclv.cu";
  const root = `${base}/Recientes/`;
  const name = "Stuart.Fails.to.Save.the.Universe.S01E01.720p.HEVC.x265-MeGusta%5bEZTVx.to%5d.mkv";
  await setCachedHtml(`<a href="${root}">Recientes</a><a href="${base}/Other/">Other</a>`);
  await setDiscoveryCache({
    [root]: { files: [{ url: root + name, size: 42 }], dirs: [] },
    [`${base}/Other/`]: { files: [{ url: `${base}/Other/${name}`, size: 42 }], dirs: [] },
  });
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Search must not fetch directories");
  };
  try {
    for (const terms of [["stuart", "fails"], ["stuart fails"], ["Stuart_Fails"], ["eztvx.to"]]) {
      const found = await searchContent(terms);
      assert.equal(found.results.length, 2);
      assert.ok(found.results.every((entry) => !entry.isDirectoryLink));
      assert.equal(await resolveSearchAlias(found.results[0].downloadId), found.results[0].encodedUrl);
    }
    const scoped = await searchContent(["stuart fails"], { root });
    assert.equal(scoped.results.length, 1);
    assert.ok(scoped.results[0].encodedUrl.startsWith(root));
    assert.equal((await searchContent([])).results.length, 2, "empty library does not serialize every file");
    const { publishIndexedDirectory } = await import("../packages/core/dist/search-file-index.js");
    await publishIndexedDirectory(root, { files: [], dirs: [`${root}Stuart.Fails/`] });
    const directory = (await searchContent(["stuart fails"])).results.find((entry) => entry.isDirectoryLink);
    assert.equal(directory.directory, "/Recientes/Stuart.Fails");
    const context = (await searchContent(["stuart fails"])).allResults.find((entry) => entry.encodedUrl === root);
    assert.equal(await resolveSearchAlias(context.downloadId), root, "exposed ancestors retain download aliases");
  } finally {
    globalThis.fetch = fetch;
    await fs.rm(home, { recursive: true, force: true });
  }
});
