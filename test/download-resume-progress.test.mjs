import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

test("resuming counts skipped files at their actual size and publishes totals before the next payload", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-resume-progress-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const { downloadUrl, downloadUrls, stopProgress } = await import("../packages/core/dist/download/downloader.js");
  const files = {
    "first.bin": Buffer.alloc(1100, 65),
    "second.bin": Buffer.alloc(2100, 66),
    "third.bin": Buffer.alloc(3100, 67),
  };
  let events = [];
  let beforePayload;
  const server = http.createServer((req, res) => {
    if (req.url.endsWith("/")) {
      res.end(
        '<pre><a href="first.bin">first.bin</a> 15-Sep-2026 09:00 1K\n<a href="second.bin">second.bin</a> 15-Sep-2026 09:00 2K\n<a href="third.bin">third.bin</a> 15-Sep-2026 09:00 3K\n</pre>'
      );
      return;
    }
    const name = req.url.split("/").at(-1);
    const data = files[name];
    if (name === "third.bin" && req.method === "GET" && !req.headers.range) beforePayload = events.at(-1)?.overall;
    res.writeHead(200, { "content-length": data.length, "accept-ranges": "bytes" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/series/`;
  try {
    for (const batch of [false, true]) {
      const output = path.join(home, batch ? "batch" : "single");
      await fs.mkdir(output);
      await fs.writeFile(path.join(output, "first.bin"), files["first.bin"]);
      await fs.writeFile(path.join(output, "second.bin"), files["second.bin"]);
      events = [];
      beforePayload = undefined;
      const options = {
        output,
        concurrent: 1,
        connections: 1,
        resume: true,
        maxRetries: 0,
        timeout: 10,
        compact: true,
        exclude: [],
      };
      const onProgress = (event) => events.push(event);
      if (batch) await downloadUrls([{ url, output, relativePath: "" }], options, onProgress);
      else await downloadUrl(url, options, onProgress);
      assert.equal(beforePayload.completedFiles, 2);
      assert.equal(
        beforePayload.downloadedBytes,
        3200,
        "skipped files use exact disk sizes, not rounded listing sizes"
      );
      assert.equal(events.at(-1).overall.downloadedBytes, 6300);
      assert.equal(events.at(-1).overall.totalBytes, 6300);
      assert.equal(events.at(-1).overall.completedFiles, 3);
      assert.equal(events.at(-1).overall.activeFiles.length, 0);
      events = [];
      await downloadUrl(url, options, onProgress);
      assert.equal(events.at(-1).overall.downloadedBytes, 6300, "fully cached runs still publish progress");
    }
  } finally {
    await stopProgress();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(home, { recursive: true, force: true });
  }
});
