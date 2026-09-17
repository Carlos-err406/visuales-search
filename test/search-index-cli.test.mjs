import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { setCachedHtml, setDiscoveryCache } from "../packages/core/dist/lib/cache.js";
import { runSearchIndexer, getSearchIndexStatus } from "../packages/core/dist/search-indexer.js";

test(
  "CLI search uses cached files; index controls share state and Ctrl-C only detaches an observer",
  { timeout: 20000 },
  async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-index-cli-"));
    process.env.HOME = process.env.USERPROFILE = home;
    const execute = (args) =>
      promisify(execFile)(process.execPath, ["dist/cli.js", ...args], { env: process.env, timeout: 10000 });
    const base = "https://visuales.uclv.cu/Recientes/";
    const abort = new AbortController();
    let owner, child;
    try {
      await setCachedHtml(`<a href="${base}">Recientes</a>`);
      await setDiscoveryCache({ [base]: { dirs: [], files: [{ url: `${base}Stuart.Fails.mkv`, size: 42 }] } });
      const { stdout } = await execute(["search", "stuart", "fails"]);
      assert.match(stdout, /Stuart\.Fails/);
      assert.equal((await getSearchIndexStatus()).running, false, "ordinary search has no worker");
      assert.match((await execute(["index", "pause"])).stdout, /paused/);
      assert.match((await execute(["index", "refresh"])).stdout, /paused/, "refresh preserves explicit pause");
      const { controlSearchIndex } = await import("../packages/core/dist/search-indexer.js");
      await controlSearchIndex("resume");
      let ready;
      const started = new Promise((resolve) => {
        ready = resolve;
      });
      owner = runSearchIndexer({
        signal: abort.signal,
        seeds: async () => [base],
        busy: async () => false,
        policy: async () => ({ allowed: () => true, delay: 0 }),
        listing: async (_url, signal) => {
          ready();
          return new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
          );
        },
      });
      await started;
      child = spawn(process.execPath, ["dist/cli.js", "index", "resume"], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = once(child, "exit");
      await once(child.stdout, "data");
      child.kill("SIGINT");
      await closed;
      assert.notEqual((await getSearchIndexStatus()).phase, "paused");
      assert.equal((await getSearchIndexStatus()).running, true);
      await execute(["index", "pause"]);
      await owner;
      assert.match((await execute(["index", "status"])).stdout, /paused/);
      await assert.rejects(execute(["index", "--not-an-option"]), /unknown option/);
    } finally {
      abort.abort();
      child?.kill();
      await owner;
      await fs.rm(home, { recursive: true, force: true });
    }
  }
);
