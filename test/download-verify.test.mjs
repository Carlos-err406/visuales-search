import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FILE_BODY, FILE_SIZE, startTestServer } from "./helpers/test-server.mjs";
import { probeRemoteCompletion, verifyDownloadedFile } from "../dist/commands/download/verify.js";
import { reconcileExistingFile } from "../dist/commands/download/reconcile.js";
import { getExistingFileState } from "../dist/commands/download/file-state.js";
import { downloadFile, stopProgress } from "../dist/commands/download/downloader.js";

const EXACT = { size: FILE_SIZE, exact: true };
const UNKNOWN = { size: 0, exact: false };

let server;
let workspace;

function options(overrides = {}) {
  return {
    output: workspace,
    resume: true,
    maxRetries: 2,
    timeout: 30,
    concurrent: 1,
    connections: 1,
    compact: true,
    exclude: [],
    ...overrides,
  };
}

async function writePartialFile(name, bytes) {
  const filePath = path.join(workspace, name);
  await fs.writeFile(filePath, FILE_BODY.subarray(0, bytes));

  return filePath;
}

async function readFileSize(filePath) {
  return (await fs.stat(filePath)).size;
}

before(async () => {
  server = await startTestServer();
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-verify-"));
});

after(async () => {
  await stopProgress();
  await server.close();
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("probeRemoteCompletion", () => {
  it("reports a whole file when the server answers 416", async () => {
    const probe = await probeRemoteCompletion(server.url("normal", "probe-full.bin"), FILE_SIZE, options());

    assert.equal(probe.known, true);
    assert.equal(probe.complete, true);
    assert.equal(probe.totalSize, FILE_SIZE);
    assert.equal(probe.acceptsRanges, true);
    assert.ok(probe.validator, "expected an ETag to use as If-Range validator");
  });

  it("reads the real total from a 206 Content-Range", async () => {
    const probe = await probeRemoteCompletion(server.url("normal", "probe-partial.bin"), FILE_SIZE / 2, options());

    assert.equal(probe.known, true);
    assert.equal(probe.complete, false);
    assert.equal(probe.totalSize, FILE_SIZE);
  });

  it("flags servers that ignore Range", async () => {
    const probe = await probeRemoteCompletion(server.url("norange", "probe-norange.bin"), FILE_SIZE / 2, options());

    assert.equal(probe.known, true);
    assert.equal(probe.acceptsRanges, false);
    assert.equal(probe.complete, false);
    assert.equal(probe.totalSize, FILE_SIZE);
  });

  it("stays unknown for the unavailable-page response", async () => {
    const probe = await probeRemoteCompletion(server.url("unavailable", "probe-gone.bin"), 10, options());

    assert.equal(probe.known, false);
  });

  it("refuses to call a file complete when the total is unknown", async () => {
    // A 206 proves bytes follow the offset; without Content-Range there is no total to
    // compare against, and answering "complete" would sign off a truncated file.
    const partial = await probeRemoteCompletion(server.url("nocontentrange", "no-cr.bin"), FILE_SIZE / 2, options());
    assert.equal(partial.known, false);
    assert.equal(partial.complete, false);
  });

  it("accepts a 416 with no Content-Range, the way visuales' Apache answers it", async () => {
    // A 416 proves the offset is at or past the end, so nothing is missing even though the
    // server disclosed no total. Treating it as unknown would re-download whole files.
    const past = await probeRemoteCompletion(server.url("nocontentrange", "no-cr.bin"), FILE_SIZE * 2, options());

    assert.equal(past.known, true);
    assert.equal(past.complete, true);
    assert.equal(past.totalSize, 0);
  });
});

describe("verifyDownloadedFile", () => {
  it("downloads the missing tail of a truncated file", async () => {
    const filePath = await writePartialFile("repair.bin", 4096);

    const result = await verifyDownloadedFile({
      url: server.url("normal", "repair.bin"),
      filePath,
      options: options(),
      expectedFileSize: UNKNOWN,
    });

    assert.equal(result.verified, true);
    assert.equal(result.size, FILE_SIZE);
    assert.equal(result.repairedBytes, FILE_SIZE - 4096);
    assert.deepEqual(await fs.readFile(filePath), FILE_BODY);
  });

  it("skips the network when the exact size already matches", async () => {
    const filePath = await writePartialFile("exact.bin", FILE_SIZE);
    const before = server.requests.length;

    const result = await verifyDownloadedFile({
      url: server.url("normal", "exact.bin"),
      filePath,
      options: options(),
      expectedFileSize: EXACT,
    });

    assert.equal(result.verified, true);
    assert.equal(server.requests.length, before, "expected no request for an already exact match");
  });

  it("discards a file larger than the remote one", async () => {
    const filePath = path.join(workspace, "oversized.bin");
    await fs.writeFile(filePath, Buffer.concat([FILE_BODY, Buffer.alloc(1024)]));

    await assert.rejects(
      verifyDownloadedFile({
        url: server.url("normal", "oversized.bin"),
        filePath,
        options: options(),
        expectedFileSize: UNKNOWN,
      }),
      /larger|remote file/i
    );
    assert.equal(await getExistingFileState(filePath), null, "expected the corrupted file to be removed");
  });

  it("re-downloads in full when the server cannot resume", async () => {
    const filePath = await writePartialFile("norange.bin", 4096);

    const result = await verifyDownloadedFile({
      url: server.url("norange", "norange.bin"),
      filePath,
      options: options(),
      expectedFileSize: UNKNOWN,
    });

    assert.equal(result.verified, true);
    assert.deepEqual(await fs.readFile(filePath), FILE_BODY);
  });

  it("rejects a file that stays incomplete and leaves nothing behind", async () => {
    const filePath = await writePartialFile("hopeless.bin", 4096);

    await assert.rejects(
      verifyDownloadedFile({
        url: server.url("norangetrunc", "hopeless.bin"),
        filePath,
        options: options({ maxRetries: 1 }),
        expectedFileSize: UNKNOWN,
      })
    );
    assert.equal(await getExistingFileState(filePath), null);
  });
});

describe("verifyDownloadedFile fallbacks", () => {
  it("keeps a file the server cannot describe, but marks it unverified", async () => {
    const filePath = await writePartialFile("unknown.bin", 4096);

    const result = await verifyDownloadedFile({
      url: server.url("nocontentrange", "unknown.bin"),
      filePath,
      options: options(),
      expectedFileSize: UNKNOWN,
    });

    assert.equal(result.verified, false);
    assert.equal(result.size, 4096);
  });

  it("rejects a size mismatch when the server cannot be reached for a second opinion", async () => {
    const filePath = await writePartialFile("mismatch.bin", 4096);

    await assert.rejects(
      verifyDownloadedFile({
        url: server.url("nocontentrange", "mismatch.bin"),
        filePath,
        options: options(),
        expectedFileSize: EXACT,
      }),
      /expected/i
    );
    assert.equal(await getExistingFileState(filePath), null);
  });

  it("rejects and removes a saved unavailable-page response", async () => {
    const filePath = path.join(workspace, "notice.bin");
    await fs.writeFile(filePath, "<html><body>Upps, no est&aacute; disponible</body></html>");

    await assert.rejects(
      verifyDownloadedFile({
        url: server.url("normal", "notice.bin"),
        filePath,
        options: options(),
        expectedFileSize: UNKNOWN,
      }),
      /unavailable-page/i
    );
    assert.equal(await getExistingFileState(filePath), null);
  });

  it("refuses to append when the server resumes at the wrong offset", async () => {
    const filePath = await writePartialFile("offset.bin", 8192);

    await assert.rejects(
      verifyDownloadedFile({
        url: server.url("badoffset", "offset.bin"),
        filePath,
        options: options({ maxRetries: 0 }),
        expectedFileSize: UNKNOWN,
      }),
      /instead of 8192|refusing to append/i
    );
  });
});

describe("reconcileExistingFile", () => {
  it("restarts when the output file is an unavailable-page response", async () => {
    const finalPath = path.join(workspace, "gone.bin");
    await fs.writeFile(finalPath, "<html><body>Upps, no est&aacute; disponible</body></html>");

    const decision = await reconcileExistingFile({
      url: server.url("normal", "gone.bin"),
      finalPath,
      tempPath: path.join(workspace, ".visuales-parts", "gone.bin"),
      existing: await getExistingFileState(finalPath),
      options: options(),
    });

    assert.equal(decision.action, "restart");
    assert.equal(await getExistingFileState(finalPath), null);
  });

  it("discards an output file bigger than the remote one", async () => {
    const finalPath = path.join(workspace, "big.bin");
    await fs.writeFile(finalPath, Buffer.concat([FILE_BODY, Buffer.alloc(512)]));

    const decision = await reconcileExistingFile({
      url: server.url("normal", "big.bin"),
      finalPath,
      tempPath: path.join(workspace, ".visuales-parts", "big.bin"),
      existing: await getExistingFileState(finalPath),
      options: options(),
    });

    assert.equal(decision.action, "restart");
    assert.equal(await getExistingFileState(finalPath), null);
  });

  it("restarts instead of resuming when resuming is disabled", async () => {
    const finalPath = await writePartialFile("noresume.bin", 4096);

    const decision = await reconcileExistingFile({
      url: server.url("normal", "noresume.bin"),
      finalPath,
      tempPath: path.join(workspace, ".visuales-parts", "noresume.bin"),
      existing: await getExistingFileState(finalPath),
      options: options({ resume: false }),
    });

    assert.equal(decision.action, "restart");
    assert.equal(await getExistingFileState(finalPath), null);
  });

  it("keeps the larger parts file when both copies are partial", async () => {
    const finalPath = await writePartialFile("bigger-parts.bin", 4096);
    const tempPath = path.join(workspace, ".visuales-parts", "bigger-parts.bin");
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, FILE_BODY.subarray(0, 16384));

    const decision = await reconcileExistingFile({
      url: server.url("normal", "bigger-parts.bin"),
      finalPath,
      tempPath,
      existing: await getExistingFileState(finalPath),
      options: options(),
    });

    assert.equal(decision.action, "resume");
    assert.equal(decision.localSize, 16384);
    assert.equal(await readFileSize(tempPath), 16384);
    assert.equal(await getExistingFileState(finalPath), null);
  });

  it("skips an output file the server confirms as whole", async () => {
    const finalPath = await writePartialFile("keep.bin", FILE_SIZE);

    const decision = await reconcileExistingFile({
      url: server.url("normal", "keep.bin"),
      finalPath,
      tempPath: path.join(workspace, ".visuales-parts", "keep.bin"),
      existing: await getExistingFileState(finalPath),
      options: options(),
    });

    assert.equal(decision.action, "skip");
    assert.equal(decision.totalSize, FILE_SIZE);
  });

  it("moves a partial output file back into the parts directory", async () => {
    const finalPath = await writePartialFile("seed.bin", 8192);
    const tempPath = path.join(workspace, ".visuales-parts", "seed.bin");

    const decision = await reconcileExistingFile({
      url: server.url("normal", "seed.bin"),
      finalPath,
      tempPath,
      existing: await getExistingFileState(finalPath),
      options: options(),
    });

    assert.equal(decision.action, "resume");
    assert.equal(decision.localSize, 8192);
    assert.equal(decision.totalSize, FILE_SIZE);
    assert.equal(await readFileSize(tempPath), 8192, "the partial file should now live in the parts directory");
    assert.equal(await getExistingFileState(finalPath), null, "the output file should have been moved, not copied");
  });
});

describe("downloadFile", () => {
  it("completes a file the flaky mirror cut short", async () => {
    const output = path.join(workspace, "flaky");
    await downloadFile(server.url("flaky", "cut.bin"), options({ output }));

    const downloaded = await fs.readFile(path.join(output, "cut.bin"));
    assert.equal(downloaded.length, FILE_SIZE);
    assert.deepEqual(downloaded, FILE_BODY);
  });

  it("recovers cleanly when the server rejects the resume validator", async () => {
    const output = path.join(workspace, "stale");
    const partsPath = path.join(output, ".visuales-parts", "stale.bin");
    await fs.mkdir(path.dirname(partsPath), { recursive: true });
    // Bytes of an older revision: appending to them would corrupt the file silently.
    await fs.writeFile(partsPath, Buffer.alloc(FILE_SIZE / 2, 0x5a));

    const before = server.requests.length;

    await downloadFile(server.url("stale", "stale.bin"), options({ output }));

    const guarded = server.requests.slice(before).find((request) => request.ifRange);
    assert.ok(guarded, "the resume must carry If-Range, otherwise the stale bytes get appended");
    assert.deepEqual(await fs.readFile(path.join(output, "stale.bin")), FILE_BODY);
  });

  it("resumes an incomplete file left in the output directory", async () => {
    const output = path.join(workspace, "resumed");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "half.bin"), FILE_BODY.subarray(0, FILE_SIZE / 2));
    const before = server.requests.length;

    await downloadFile(server.url("normal", "half.bin"), options({ output }));

    const resumeRequest = server.requests
      .slice(before)
      .find((request) => request.range === `bytes=${FILE_SIZE / 2}-` && request.ifRange);
    assert.ok(resumeRequest, "expected a ranged request carrying If-Range from the existing bytes");
    assert.deepEqual(await fs.readFile(path.join(output, "half.bin")), FILE_BODY);
  });
});
