import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import pLimit from "p-limit";
import type { FetchDownloadRequest, FetchDownloadResult } from "./fetch-download.js";
import { checkRetryableStatus, createDownloadHeaders, getRequestTimeoutSignal, isUnavailableResponse } from "./http.js";
import { getFileSize } from "./file-state.js";
import { MAX_CONNECTIONS_PER_FILE } from "./limits.js";

const MIN_PARALLEL_SIZE = 10 * 1024 * 1024;
// Shared by files in one CLI process or desktop transfer worker, not across OS processes.
const connectionSlots = pLimit(16);

export async function withDownloadConnection<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return connectionSlots(work);
  return new Promise<T>((resolve, reject) => {
    let started = false;
    // Queued work can settle immediately; active work must finish closing streams before callers clean up.
    const onAbort = () => {
      if (!started) reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void connectionSlots(() => {
      signal.throwIfAborted();
      started = true;
      return work();
    })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

interface Metadata {
  version: 1;
  url: string;
  finalUrl: string;
  size: number;
  validator: string;
  validatorHeader: "etag" | "last-modified";
  chunkSize: number;
}

class UnsafeRangeError extends Error {}

function partsDirectory(tempPath: string): string {
  return path.join(
    path.dirname(tempPath),
    `.ranges-${createHash("sha256").update(path.resolve(tempPath)).digest("hex")}`
  );
}

export async function clearParallelParts(tempPath: string): Promise<void> {
  await fs.rm(partsDirectory(tempPath), { recursive: true, force: true });
}

function range(response: Response): { start: number; end: number; size: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get("content-range") ?? "");
  if (!match) return null;
  const [start, end, size] = match.slice(1).map(Number);
  return [start, end, size].every(Number.isSafeInteger) && start >= 0 && end >= start && size > end
    ? { start, end, size }
    : null;
}

function isIdentity(response: Response): boolean {
  const encoding = response.headers.get("content-encoding");
  return !encoding || encoding.toLowerCase() === "identity";
}

function validator(response: Response): Pick<Metadata, "validator" | "validatorHeader"> | null {
  const etag = response.headers.get("etag");
  if (etag && /^"[^"\r\n]*"$/.test(etag)) return { validator: etag, validatorHeader: "etag" };
  // A Last-Modified date is only a strong client validator when sufficiently older than Date.
  const modified = response.headers.get("last-modified");
  const date = Date.parse(response.headers.get("date") ?? "");
  if (!etag && modified && date - Date.parse(modified) >= 60_000)
    return { validator: modified, validatorHeader: "last-modified" };
  return null;
}

function signal(request: FetchDownloadRequest, abort?: AbortSignal): AbortSignal | undefined {
  const signals = [request.signal, abort, getRequestTimeoutSignal(request.options)].filter(
    (value): value is AbortSignal => Boolean(value)
  );
  return signals.length ? AbortSignal.any(signals) : undefined;
}

async function probe(request: FetchDownloadRequest): Promise<Metadata | null> {
  return withDownloadConnection(async () => {
    request.signal?.throwIfAborted();
    const response = await fetch(request.url, {
      headers: createDownloadHeaders({ Range: "bytes=0-0" }),
      signal: signal(request),
    });
    try {
      checkRetryableStatus(response);
      const contentRange = range(response);
      const identity = validator(response);
      if (
        response.status !== 206 ||
        !contentRange ||
        contentRange.start !== 0 ||
        contentRange.end !== 0 ||
        !identity ||
        !isIdentity(response) ||
        isUnavailableResponse(response) ||
        !response.body
      )
        return null;
      let received = 0;
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > 1) return null;
      }
      if (received !== 1) return null;
      return {
        version: 1,
        url: request.url,
        finalUrl: response.url,
        size: contentRange.size,
        ...identity,
        chunkSize: Math.max(4 * 1024 * 1024, Math.ceil(contentRange.size / 128)),
      };
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }, request.signal);
}

async function writeAll(file: fs.FileHandle, buffer: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new Error("Could not write download data");
    offset += bytesWritten;
  }
}

/** Returns null when the existing single-stream downloader should handle this file. */
export async function downloadInParallel(request: FetchDownloadRequest): Promise<FetchDownloadResult | null> {
  if (request.forceResume) return null;
  const requested = request.options.connections;
  if (!Number.isInteger(requested) || requested < 1) throw new Error("Connections must be a positive whole number");
  const connections = Math.min(requested, MAX_CONNECTIONS_PER_FILE);
  const directory = partsDirectory(request.tempPath);
  const manifest = path.join(directory, "manifest.json");
  let previous: string | undefined;
  try {
    previous = await fs.readFile(manifest, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!request.options.resume) {
    await clearParallelParts(request.tempPath);
    previous = undefined;
  }
  if (!previous) {
    if (connections === 1 || (request.expectedFileSize.exact && request.expectedFileSize.size <= MIN_PARALLEL_SIZE))
      return null;
    // Legacy partial files contain a contiguous prefix; keep their established resume behavior.
    if (request.options.resume && (await getFileSize(request.tempPath))) return null;
  }

  const metadata = await probe(request);
  const discard = async () => {
    await clearParallelParts(request.tempPath);
    if (previous) await fs.rm(request.tempPath, { force: true });
  };
  if (!metadata || metadata.size <= MIN_PARALLEL_SIZE) {
    await discard();
    return null;
  }
  const serialized = JSON.stringify(metadata);
  if (previous !== serialized) {
    await discard();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(`${manifest}.tmp`, serialized);
    await fs.rename(`${manifest}.tmp`, manifest);
  }

  const count = Math.ceil(metadata.size / metadata.chunkSize);
  const lengths = Array.from({ length: count }, (_, index) =>
    Math.min(metadata.chunkSize, metadata.size - index * metadata.chunkSize)
  );
  const completed: number[] = [];
  for (let index = 0; index < count; index++) {
    const file = path.join(directory, String(index));
    let size = (await getFileSize(file)) ?? 0;
    if (size > lengths[index]) {
      await fs.rm(file);
      size = 0;
    }
    completed.push(size);
  }
  const initialBytes = completed.reduce((sum, bytes) => sum + bytes, 0);
  const started = Date.now();
  const report = () => {
    const downloadedBytes = completed.reduce((sum, bytes) => sum + bytes, 0);
    request.onProgress?.({
      downloadedBytes,
      totalBytes: metadata.size,
      percentage: (downloadedBytes / metadata.size) * 100,
      speedBytes: (downloadedBytes - initialBytes) / Math.max((Date.now() - started) / 1000, 0.001),
    });
  };
  const abort = new AbortController();
  const workerSignal = request.signal ? AbortSignal.any([abort.signal, request.signal]) : abort.signal;
  let next = 0;
  let failure: unknown;
  async function worker(metadata: Metadata) {
    try {
      while (next < count) {
        const index = next++;
        if (completed[index] === lengths[index]) continue;
        await withDownloadConnection(async () => {
          abort.signal.throwIfAborted();
          request.signal?.throwIfAborted();
          const start = index * metadata.chunkSize + completed[index];
          const end = index * metadata.chunkSize + lengths[index] - 1;
          const response = await fetch(request.url, {
            headers: createDownloadHeaders({ Range: `bytes=${start}-${end}`, "If-Range": metadata.validator }),
            signal: signal(request, abort.signal),
          });
          try {
            checkRetryableStatus(response);
            const receivedRange = range(response);
            const responseValidator = response.headers.get(metadata.validatorHeader);
            if (
              response.status !== 206 ||
              !receivedRange ||
              receivedRange.start !== start ||
              receivedRange.end !== end ||
              receivedRange.size !== metadata.size ||
              response.url !== metadata.finalUrl ||
              !isIdentity(response) ||
              isUnavailableResponse(response) ||
              (responseValidator !== null && responseValidator !== metadata.validator)
            )
              throw new UnsafeRangeError("Server did not honor the negotiated file range");
            const contentLength = response.headers.get("content-length");
            if (contentLength !== null && Number(contentLength) !== end - start + 1)
              throw new UnsafeRangeError("Server returned an inconsistent range length");
            if (!response.body) throw new UnsafeRangeError("Missing range response body");
            const file = await fs.open(path.join(directory, String(index)), "a");
            try {
              for await (const buffer of response.body) {
                if (completed[index] + buffer.length > lengths[index])
                  throw new UnsafeRangeError("Server returned too many range bytes");
                await writeAll(file, buffer);
                completed[index] += buffer.length;
                report();
              }
              if (completed[index] !== lengths[index])
                throw Object.assign(new Error("Range response ended before all bytes arrived"), {
                  code: "ERR_DOWNLOAD_RETRYABLE",
                });
            } finally {
              await file.close();
            }
          } finally {
            await response.body?.cancel().catch(() => {});
          }
        }, workerSignal);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        failure = error;
        abort.abort(error);
      }
    }
  }
  report();
  await Promise.all(Array.from({ length: Math.min(connections, count) }, () => worker(metadata)));
  request.signal?.throwIfAborted();
  if (failure instanceof UnsafeRangeError) {
    await discard();
    await fs.rm(request.tempPath, { force: true });
    return null;
  }
  if (failure) throw failure;

  // Never expose a sparse or partially assembled file to the existing size-based verifier.
  const assembled = path.join(directory, "assembled");
  const output = await fs.open(assembled, "w");
  try {
    for (let index = 0; index < count; index++) {
      request.signal?.throwIfAborted();
      const input = await fs.open(path.join(directory, String(index)), "r");
      try {
        for await (const buffer of input.createReadStream()) await writeAll(output, buffer);
      } finally {
        await input.close();
      }
    }
    if ((await output.stat()).size !== metadata.size) throw new Error("Assembled download size is incorrect");
  } finally {
    await output.close();
  }
  await fs.rm(request.tempPath, { force: true });
  await fs.rename(assembled, request.tempPath);
  // Keep segments until the caller promotes the verified file; interruption during assembly is resumable.
  return {
    downloadedBytes: metadata.size,
    totalBytes: metadata.size,
    resumed: initialBytes > 0,
    exactSize: metadata.size,
  };
}
