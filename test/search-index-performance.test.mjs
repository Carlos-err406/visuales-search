import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setCachedHtml } from "../packages/core/dist/lib/cache.js";
import { publishIndexedDirectory } from "../packages/core/dist/search-file-index.js";
import { searchContent } from "../packages/core/dist/search.js";

test(
  "large catalog queries reuse normalized records and keep empty-library payloads small",
  { timeout: 30000 },
  async (t) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-index-perf-"));
    process.env.HOME = process.env.USERPROFILE = home;
    try {
      let html = "";
      for (let dir = 0; dir < 100; dir++) {
        const url = `https://visuales.uclv.cu/Folder${dir}/`;
        html += `<a href="${url}">Folder${dir}</a>`;
        await publishIndexedDirectory(url, {
          dirs: [],
          files: Array.from({ length: 1000 }, (_, file) => ({ url: `${url}Episode.Number.${file}.mkv`, size: 1000 })),
        });
      }
      await setCachedHtml(html);
      const start = performance.now();
      const first = await searchContent(["episode number 987"]);
      const cold = performance.now() - start;
      assert.equal(first.results.length, 100);
      const times = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        assert.equal((await searchContent(["episode", "number", "987"])).results.length, 100);
        times.push(performance.now() - start);
      }
      const empty = await searchContent([]);
      assert.equal(empty.results.length, 100);
      assert.ok(JSON.stringify(empty).length < 100000);
      t.diagnostic(
        `100,000 files: cold ${cold.toFixed(1)} ms; warm ${times.map((ms) => ms.toFixed(1)).join(", ")} ms; heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MiB; empty payload ${JSON.stringify(empty).length} bytes`
      );
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }
);
