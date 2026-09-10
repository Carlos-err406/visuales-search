import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";

let home, server, library, cache;
const realFetch = globalThis.fetch;
const originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const calls = new Map();
const base = "https://visuales.uclv.cu";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64"
);
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-library-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  library = await import("../packages/core/dist/library.js");
  cache = await import("../packages/core/dist/lib/cache.js");
  server = http.createServer((req, res) => {
    calls.set(req.url, (calls.get(req.url) || 0) + 1);
    if (req.url === "/redirect.txt") {
      res.writeHead(302, { location: "http://127.0.0.1/private" });
      return res.end();
    }
    if (req.url === "/missing.txt") {
      res.writeHead(404);
      return res.end();
    }
    if (req.url === "/empty/") return res.end('<pre><a href="../">Parent Directory</a></pre>');
    if (req.url === "/blocked/") return res.end("<title>URL not available</title><table></table>");
    if (req.url === "/Movies/")
      return res.end(
        '<pre><a href="../">Parent Directory</a><a href="Part%201/">Part 1</a> -\n<a href="notes.txt">notes.txt</a> 10-Sep-2026 10:00 42\n<a href="notes.txt">duplicate</a><a href="../../escape.txt">escape</a><a href="https://evil.test/file">outside</a></pre>'
      );
    if (req.url.endsWith(".png")) {
      res.setHeader("content-type", "image/png");
      return res.end(png);
    }
    if (req.url === "/fake.jpg") {
      res.setHeader("content-type", "text/html");
      return res.end("<html>Error</html>");
    }
    if (req.url === "/binary.txt") return res.end(Buffer.from([0, 1, 2]));
    if (req.url === "/latin.txt") return res.end(Buffer.from([255, 254]));
    if (req.url === "/large.txt") {
      res.write("x".repeat(300000));
      return res.end("x".repeat(300000));
    }
    if (req.url === "/length.txt") {
      res.writeHead(200, { "content-length": "600000" });
      return res.end();
    }
    res.setHeader("content-type", req.url.endsWith(".html") ? "text/html" : "text/plain");
    res.end("<script>window.remoteExecuted = true</script>\nHello library");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  // Keep real HTTP streaming and the production parser/cache; route the approved origin to a local fixture.
  globalThis.fetch = (url, options) =>
    realFetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
});
after(async () => {
  globalThis.fetch = realFetch;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(originalHome)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(home, { recursive: true, force: true });
});

test("directory browsing reuses core discovery, deduplicates children and handles empty/cache/refresh", async () => {
  const entries = await library.listLibraryDirectory(`${base}/Movies/`);
  assert.deepEqual(entries.map((entry) => entry.text).sort(), ["Part 1", "notes.txt"]);
  assert.equal(entries.find((entry) => entry.text === "notes.txt").size, 42);
  await library.listLibraryDirectory(`${base}/Movies/`);
  assert.equal(calls.get("/Movies/"), 1);
  await library.listLibraryDirectory(`${base}/Movies/`, true);
  assert.equal(calls.get("/Movies/"), 2);
  assert.deepEqual(await library.listLibraryDirectory(`${base}/empty/`), []);
  await library.listLibraryDirectory(`${base}/empty/`);
  assert.equal(calls.get("/empty/"), 1);
  await cache.clearCacheById("discovery");
  await library.listLibraryDirectory(`${base}/empty/`);
  assert.equal(calls.get("/empty/"), 2);
  await assert.rejects(library.listLibraryDirectory(`${base}/blocked/`), /did not return/);
  await fs.writeFile(path.join(home, ".visuales-cli-cache", "discovery.json"), JSON.stringify({ broken: {} }));
  assert.deepEqual(await library.listLibraryDirectory(`${base}/empty/`, true), []);
});

test("image and text previews persist, refresh, coalesce and participate in CLI cache management", async () => {
  const text = await library.previewLibraryFile(`${base}/notes.txt`);
  assert.equal(text.kind, "text");
  assert.match(text.content, /<script>/);
  assert.equal(text.cached, false);
  assert.equal((await library.previewLibraryFile(`${base}/notes.txt`)).cached, true);
  assert.equal(calls.get("/notes.txt"), 1);
  const image = await library.previewLibraryFile(`${base}/cover.png`);
  assert.equal(image.mime, "image/png");
  assert.deepEqual(Buffer.from(image.content, "base64"), png);
  await Promise.all(Array.from({ length: 3 }, () => library.previewLibraryFile(`${base}/cover.png`, true)));
  assert.equal(calls.get("/cover.png"), 2);
  assert.ok((await cache.listCaches()).some((entry) => entry.id === "previews"));
  assert.equal((await cache.getCacheInfo("previews")).size, 2);
  await cache.clearCacheById("previews");
  assert.equal((await library.previewLibraryFile(`${base}/notes.txt`)).cached, false);
  assert.equal(calls.get("/notes.txt"), 2);
});

test("stale/corrupt previews are replaced and disk cache is bounded", async () => {
  const dir = path.join(home, ".visuales-cli-cache", "previews");
  const name = createHash("sha256").update(`${base}/notes.txt`).digest("hex") + ".json";
  await fs.writeFile(path.join(dir, name), "bad json");
  assert.equal((await library.previewLibraryFile(`${base}/notes.txt`)).cached, false);
  await fs.utimes(path.join(dir, name), new Date(0), new Date(0));
  assert.equal((await library.previewLibraryFile(`${base}/notes.txt`)).cached, false);
  const oversized = path.join(dir, "a".repeat(64) + ".json");
  await fs.writeFile(oversized, "x".repeat(33 * 1024 * 1024));
  await fs.utimes(oversized, new Date(100), new Date(100));
  await library.previewLibraryFile(`${base}/another.txt`);
  await assert.rejects(fs.stat(oversized), { code: "ENOENT" });
});

test("previews reject private hosts, credentials, redirects, unsupported files, binary and oversized data", async () => {
  for (const url of [
    "file:///etc/passwd",
    "http://127.0.0.1/test.txt",
    "https://visuales.uclv.cu.evil.test/a.txt",
    "https://user@visuales.uclv.cu/a.txt",
    `${base}:444/a.txt`,
    `${base}/a.txt?q=x`,
  ]) {
    await assert.rejects(library.previewLibraryFile(url));
    await assert.rejects(library.listLibraryDirectory(url));
  }
  for (const [file, pattern] of [
    ["redirect.txt", /Only Visuales/],
    ["missing.txt", /404/],
    ["video.mkv", /not available/],
    ["fake.jpg", /not a supported image/],
    ["binary.txt", /binary/],
    ["latin.txt", /UTF-8/],
    ["large.txt", /too large/],
    ["length.txt", /too large/],
  ]) {
    await assert.rejects(library.previewLibraryFile(`${base}/${file}`), pattern);
  }
});
