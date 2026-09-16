import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-completion-safety-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { downloadUrl, stopProgress } = await import("../packages/core/dist/download/downloader.js");
const { recordDownloadFiles, readDownloadFileDetails, reportDownloadFile } =
  await import("../packages/core/dist/download/file-details.js");
const { dirListingCache, DIRECTORY_LISTING_PARSER_VERSION } =
  await import("../packages/core/dist/download/discovery-cache.js");
after(async () => {
  await stopProgress();
  await fs.rm(home, { recursive: true, force: true });
});

const body = Buffer.alloc(1000, 120);
const options = (output) => ({
  output,
  concurrent: 1,
  connections: 1,
  resume: true,
  maxRetries: 0,
  timeout: 5,
  compact: true,
  exclude: [],
});

async function fixture(t, mode) {
  const requests = [];
  let metadataAvailable = mode === "legacy";
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, range: req.headers.range });
    if (req.url.endsWith("/")) {
      res.end('<pre><a href="file.bin">file.bin</a> 16-Sep-2026 09:00 400</pre>');
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, metadataAvailable ? { "content-length": body.length } : {});
      res.end();
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      const known = metadataAvailable || (mode === "repair" && start > 0);
      if (start >= body.length) {
        res.writeHead(416, known ? { "content-range": `bytes */${body.length}` } : {});
        res.end();
      } else {
        res.writeHead(206, {
          ...(known ? { "content-range": `bytes ${start}-${end}/${body.length}`, etag: '"v1"' } : {}),
          "transfer-encoding": "chunked",
        });
        res.end(body.subarray(start, end + 1));
      }
      return;
    }
    const full = metadataAvailable || mode === "fresh-get" || mode === "no-total";
    res.writeHead(200, mode === "fresh-get" ? { "content-length": body.length } : { "transfer-encoding": "chunked" });
    res.end(full ? body : body.subarray(0, 400));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/folder/`;
  const output = await fs.mkdtemp(path.join(home, "download-"));
  const events = [];
  const run = () =>
    recordDownloadFiles(output, output, () => downloadUrl(url, options(output), (event) => events.push(event)), {
      resume: true,
    });
  return {
    url,
    output,
    events,
    requests,
    run,
    enableMetadata: () => {
      metadataAvailable = true;
    },
  };
}

test("unknown completion fails instead of promoting partial data or incrementing completed files", async (t) => {
  const f = await fixture(t, "unknown");
  await assert.rejects(f.run());
  const file = (await readDownloadFileDetails(f.output)).files[0];
  assert.equal(file.status, "failed");
  assert.equal(file.verified, false);
  assert.equal(file.verificationVersion, undefined);
  assert.match(file.error, /Could not verify download completion/);
  assert.ok(f.events.every((event) => event.overall?.completedFiles === 0));
  await assert.rejects(fs.stat(path.join(f.output, "file.bin")), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile(path.join(f.output, ".visuales-parts", "file.bin")), body.subarray(0, 400));
  f.enableMetadata();
  await f.run();
  assert.deepEqual(await fs.readFile(path.join(f.output, "file.bin")), body);
  assert.equal((await readDownloadFileDetails(f.output)).files[0].status, "completed");
});

for (const existing of [false, true]) {
  test(`stale exact cache cannot certify ${existing ? "an existing" : "a newly downloaded"} short file`, async (t) => {
    const f = await fixture(t, "repair");
    dirListingCache.set(f.url, {
      files: [{ url: `${f.url}file.bin`, size: 400, exact: true }],
      dirs: [],
      parserVersion: DIRECTORY_LISTING_PARSER_VERSION,
    });
    if (existing) await fs.writeFile(path.join(f.output, "file.bin"), body.subarray(0, 400));
    await f.run();
    assert.deepEqual(await fs.readFile(path.join(f.output, "file.bin")), body);
    const file = (await readDownloadFileDetails(f.output)).files[0];
    assert.equal(file.downloadedBytes, body.length);
    assert.equal(file.verified, true);
    assert.equal(file.verificationVersion, 1);
    assert.ok(f.requests.some((req) => req.range === "bytes=400-"));
  });
}

test("a size-less 416 does not certify a finished parts file; a later exact check can promote it", async (t) => {
  const f = await fixture(t, "no-total");
  await assert.rejects(f.run());
  const partial = path.join(f.output, ".visuales-parts", "file.bin");
  assert.deepEqual(await fs.readFile(partial), body);
  assert.equal((await readDownloadFileDetails(f.output)).files[0].status, "failed");
  await assert.rejects(fs.stat(path.join(f.output, "file.bin")), { code: "ENOENT" });
  f.enableMetadata();
  f.requests.length = 0;
  await f.run();
  assert.deepEqual(await fs.readFile(path.join(f.output, "file.bin")), body);
  assert.ok(
    f.requests.every((req) => req.method === "HEAD"),
    "already received data only needs a metadata check"
  );
});

test("fresh full-response length can verify a file even when HEAD and the initial range probe fail", async (t) => {
  const f = await fixture(t, "fresh-get");
  await f.run();
  assert.deepEqual(await fs.readFile(path.join(f.output, "file.bin")), body);
  assert.equal((await readDownloadFileDetails(f.output)).files[0].verified, true);
});

test("legacy verified completions are checked once before qualifying for the local shortcut", async (t) => {
  const f = await fixture(t, "legacy");
  await fs.writeFile(path.join(f.output, "file.bin"), body.subarray(0, 400));
  await recordDownloadFiles(f.output, f.output, async () =>
    reportDownloadFile(`${f.url}file.bin`, f.output, "file.bin", {
      status: "completed",
      verified: true,
      downloadedBytes: 400,
      totalBytes: 400,
    })
  );
  await f.run();
  assert.deepEqual(await fs.readFile(path.join(f.output, "file.bin")), body);
  assert.ok(f.requests.some((req) => req.range === "bytes=400-"));
  f.requests.length = 0;
  await f.run();
  assert.deepEqual(f.requests, [], "the next resume uses the newly verified local record");
});
