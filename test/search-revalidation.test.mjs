import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("revalidating the search index replaces only the index and retains it on fetch failure", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-search-revalidate-"));
  const originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const fetch = globalThis.fetch;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const { setCachedHtml } = await import("../packages/core/dist/lib/cache.js");
    const { searchContent } = await import("../packages/core/dist/search.js");
    const directory = path.join(home, ".visuales-cli-cache");
    await setCachedHtml('<a href="https://visuales.uclv.cu/Old/">Old</a>');
    const untouched = ["discovery.json", "desktop-settings.json", "download/saved.json", "previews/saved.json"];
    for (const file of untouched) {
      await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await fs.writeFile(path.join(directory, file), "{}");
    }
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return new Response('<a href="https://visuales.uclv.cu/New/">New</a>');
    };
    assert.deepEqual(
      (await searchContent([])).results.map((entry) => entry.text),
      ["Old"]
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(
      (await searchContent([], { noCache: true })).results.map((entry) => entry.text),
      ["New"]
    );
    assert.deepEqual(calls, ["https://visuales.uclv.cu/listado.html"]);
    assert.deepEqual(
      (await searchContent([])).results.map((entry) => entry.text),
      ["New"]
    );
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    await assert.rejects(searchContent([], { noCache: true }), /503/);
    assert.deepEqual(
      (await searchContent([])).results.map((entry) => entry.text),
      ["New"]
    );
    for (const file of untouched) assert.equal(await fs.readFile(path.join(directory, file), "utf8"), "{}");
  } finally {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries(originalHome)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
});
