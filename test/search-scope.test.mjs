import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("scoped search includes only its indexed branch and root files, with stable shared aliases", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-search-scope-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const { setCachedHtml } = await import("../packages/core/dist/lib/cache.js");
  const { searchContent } = await import("../packages/core/dist/search.js");
  const base = "https://visuales.uclv.cu";
  const root = `${base}/Movies/Example/`;
  const urls = [root, `${root}Extras/`, `${root}Extras/Deep/`, `${base}/Movies/Example-2/`, `${base}/Other/Example/`];
  await setCachedHtml(urls.map((url) => `<a href="${url}">${url.split("/").at(-2)}</a>`).join("\n"));
  const fetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    assert.equal(String(url), root, "never crawl outside the scoped root");
    return new Response(
      '<pre><a href="../">Parent Directory</a><a href="Extras/">Extras</a> -\n<a href="notes.txt">notes.txt</a> 15-Sep-2026 09:00 42\n</pre>'
    );
  };
  try {
    const global = await searchContent([]);
    const branch = await searchContent([], { root });
    assert.deepEqual(branch.results.map((item) => item.text).sort(), ["Deep", "Extras", "notes.txt"]);
    assert.equal(
      branch.results.find((item) => item.text === "Extras").downloadId,
      global.results.find((item) => item.text === "Extras").downloadId
    );
    assert.deepEqual(
      (await searchContent(["deep"], { root })).results.map((item) => item.text),
      ["Deep"]
    );
    assert.deepEqual(
      (await searchContent(["notes"], { root })).results.map((item) => item.text),
      ["notes.txt"]
    );
    assert.equal((await searchContent(["Other"], { root })).totalResults, 0);
    assert.equal(calls.length, 1, "branch browsing and searches reuse the directory cache");
    assert.equal((await searchContent(["Example"])).totalResults, 5, "unscoped CLI search stays unchanged");
    await assert.rejects(searchContent([], { root: `${base}/Movies/file.txt` }), /directory/);
    await assert.rejects(searchContent([], { root: "https://example.com/Movies/" }), /library|visuales/i);
  } finally {
    globalThis.fetch = fetch;
    await fs.rm(home, { recursive: true, force: true });
  }
});
