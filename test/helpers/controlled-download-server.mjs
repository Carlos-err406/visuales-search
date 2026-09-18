import http from "node:http";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

export async function waitUntil(predicate, message = "condition", timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  assert.fail(`Timed out waiting for ${message}`);
}

/** Metadata responds immediately; each payload waits for an explicit completion. */
export async function controlledDownloadServer(names) {
  const body = Buffer.alloc(16 * 1024, 65);
  const held = new Map();
  const started = [];
  const aborted = [];
  let automatic = false;
  let failing = false;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://fixture").pathname.slice(1));
    if (req.url.endsWith("/")) {
      const entries = new Set(
        names
          .filter((file) => file.startsWith(name))
          .map((file) => {
            const tail = file.slice(name.length);
            return tail.includes("/") ? tail.slice(0, tail.indexOf("/") + 1) : tail;
          })
      );
      res.end(
        `<pre>${[...entries].map((entry) => `<a href="${entry}">${entry}</a> 18-Sep-2026 10:00 ${entry.endsWith("/") ? "-" : body.length}\n`).join("")}</pre>`
      );
      return;
    }
    if (!names.includes(name)) {
      res.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : body.length - 1;
    if (start >= body.length) {
      res.writeHead(416, { "content-range": `bytes */${body.length}` }).end();
      return;
    }
    if (failing && req.method === "GET" && end > start) {
      res.writeHead(503).end("Fixture failure");
      return;
    }
    res.writeHead(range ? 206 : 200, {
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      etag: '"controlled-file"',
      ...(range ? { "content-range": `bytes ${start}-${end}/${body.length}` } : {}),
    });
    if (req.method === "HEAD" || start === end) {
      res.end(req.method === "HEAD" ? undefined : body.subarray(start, end + 1));
      return;
    }
    started.push(name);
    if (automatic) {
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.write(body.subarray(start, start + 1));
    held.set(name, () => res.end(body.subarray(start + 1, end + 1)));
    res.on("close", () => {
      if (!res.writableEnded) aborted.push(name);
      held.delete(name);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    body,
    started,
    aborted,
    held,
    fail(value) {
      failing = value;
    },
    finish(name) {
      assert.ok(held.has(name), `${name} has an active payload`);
      held.get(name)();
    },
    releaseAll() {
      automatic = true;
      for (const finish of held.values()) finish();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
