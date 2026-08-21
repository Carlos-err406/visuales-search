import http from "node:http";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export const FILE_SIZE = 1024 * 1024;

export const FILE_BODY = (() => {
  const body = Buffer.alloc(FILE_SIZE);
  for (let offset = 0; offset < FILE_SIZE; offset += 32) {
    createHash("sha256")
      .update(String(offset))
      .digest()
      .copy(body, offset, 0, Math.min(32, FILE_SIZE - offset));
  }
  return body;
})();

const ETAG = `"${createHash("sha1").update(FILE_BODY).digest("hex").slice(0, 16)}"`;
const UNAVAILABLE_PAGE =
  "<html><head><title>Upps</title></head><body>El recurso no est&aacute; disponible. ayuda.uclv.edu.cu</body></html>";
const TRUNCATED_SIZE = Math.floor(FILE_SIZE * 0.4);

function parseRange(header) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? "");
  if (!match) return null;

  return { start: Number(match[1]), end: match[2] === "" ? FILE_SIZE - 1 : Number(match[2]) };
}

/**
 * Mirrors the behaviours of the visuales Apache server that break downloads. The first path
 * segment picks the mode:
 *
 * - `normal`        well-behaved server with HEAD, Content-Length and ranges
 * - `truncate`      full GETs end cleanly at 40% with no Content-Length
 * - `flaky`         like `truncate` for the first GET, and neither HEAD nor the 1-byte probe
 *                   answer, so the client never learns an exact size
 * - `norange`       ignores Range and always replies 200 with the whole body
 * - `norangetrunc`  ignores Range and truncates every full GET
 * - `unavailable`   replies with the HTML "not available" notice
 * - `nocontentrange` answers 206/416 but strips Content-Range, so the total stays unknown
 * - `stale`         treats every If-Range as stale and replies 200 with the whole body
 * - `badoffset`     answers 206 starting 64 bytes before the requested offset
 */
export async function startTestServer() {
  const requests = [];
  const truncated = new Set();

  const server = http.createServer((req, res) => {
    const [, mode = "normal", file = "file.bin"] = req.url.split("/");
    const range = parseRange(req.headers.range);
    requests.push({
      mode,
      file,
      method: req.method,
      range: req.headers.range ?? null,
      ifRange: req.headers["if-range"] ?? null,
    });

    if (mode === "unavailable") {
      res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
      res.end(UNAVAILABLE_PAGE);
      return;
    }

    const hidesMetadata = mode === "flaky" || mode === "norangetrunc";
    if (hidesMetadata && (req.method === "HEAD" || (range && range.start === 0 && range.end === 0))) {
      req.socket.destroy();
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, { "content-length": String(FILE_SIZE), "accept-ranges": "bytes", etag: ETAG });
      res.end();
      return;
    }

    if (mode === "norange" || mode === "norangetrunc") {
      // A ranged request still reveals the real size through the plain 200 it answers with.
      if (range || mode === "norange") {
        res.writeHead(200, { "content-length": String(FILE_SIZE), etag: ETAG });
        res.end(FILE_BODY);
        return;
      }

      res.writeHead(200, {});
      res.end(FILE_BODY.subarray(0, TRUNCATED_SIZE));
      return;
    }

    if (range && mode === "nocontentrange") {
      const status = range.start >= FILE_SIZE ? 416 : 206;
      res.writeHead(status, { etag: ETAG });
      res.end(status === 206 ? FILE_BODY.subarray(range.start, range.start + 1) : undefined);
      return;
    }

    // A server that considers the client's validator stale must answer with the full
    // representation rather than a partial one.
    if (range && mode === "stale" && req.headers["if-range"]) {
      res.writeHead(200, { "content-length": String(FILE_SIZE), etag: ETAG });
      res.end(FILE_BODY);
      return;
    }

    if (range && mode === "badoffset" && range.start > 64) {
      const start = range.start - 64;
      const end = Math.min(range.end, FILE_SIZE - 1);
      res.writeHead(206, {
        "content-range": `bytes ${start}-${end}/${FILE_SIZE}`,
        "content-length": String(end - start + 1),
        etag: ETAG,
      });
      res.end(FILE_BODY.subarray(start, end + 1));
      return;
    }

    if (range) {
      if (range.start >= FILE_SIZE) {
        res.writeHead(416, { "content-range": `bytes */${FILE_SIZE}`, etag: ETAG });
        res.end();
        return;
      }

      const end = Math.min(range.end, FILE_SIZE - 1);
      const slice = FILE_BODY.subarray(range.start, end + 1);
      res.writeHead(206, {
        "content-range": `bytes ${range.start}-${end}/${FILE_SIZE}`,
        "content-length": String(slice.length),
        "accept-ranges": "bytes",
        etag: ETAG,
      });
      res.end(slice);
      return;
    }

    // A clean end at 40% with no Content-Length looks like a complete body to the client.
    if (mode === "truncate" || (mode === "flaky" && !truncated.has(file))) {
      truncated.add(file);
      res.writeHead(200, { "accept-ranges": "bytes", etag: ETAG });
      res.end(FILE_BODY.subarray(0, TRUNCATED_SIZE));
      return;
    }

    res.writeHead(200, { "content-length": String(FILE_SIZE), "accept-ranges": "bytes", etag: ETAG });
    res.end(FILE_BODY);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    requests,
    truncatedSize: TRUNCATED_SIZE,
    url: (mode, file) => `http://127.0.0.1:${port}/${mode}/${file}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
