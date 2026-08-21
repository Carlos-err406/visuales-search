import fs from "fs/promises";
import { DownloadOptions } from "./types.js";
import {
  createDownloadHeaders,
  ExpectedFileSize,
  getRangeValidator,
  getRequestTimeoutSignal,
  isUnavailableResponse,
  parseContentRangeTotal,
} from "./http.js";
import { getFileSize, isUnavailablePageFile } from "./file-state.js";
import { downloadWithFetch, type FetchDownloadProgress } from "./fetch-download.js";
import { formatSize } from "./utils.js";

export interface RemoteFileProbe {
  /** The server answered with usable size information. */
  known: boolean;
  complete: boolean;
  /** Total remote size, 0 when the server did not disclose it. */
  totalSize: number;
  /** False when the server ignored the Range header and replied 200. */
  acceptsRanges: boolean;
  validator?: string;
}

export interface VerifyDownloadRequest {
  url: string;
  filePath: string;
  options: DownloadOptions;
  expectedFileSize: ExpectedFileSize;
  onStatus?: (status: string) => void;
  onProgress?: (progress: FetchDownloadProgress) => void;
  log?: (message: string) => void;
}

export interface VerifyDownloadResult {
  size: number;
  /** Remote size confirmed by the server, 0 when it stayed unknown. */
  totalSize: number;
  /** True when the server confirmed the file is whole. */
  verified: boolean;
  repairedBytes: number;
}

const UNKNOWN_PROBE: RemoteFileProbe = {
  known: false,
  complete: false,
  totalSize: 0,
  acceptsRanges: false,
};

/**
 * Asks the server whether anything follows the bytes already on disk.
 *
 * A 416 means the requested range starts at or past the end of the file (nothing left to
 * download), while a 206 carries the real total in Content-Range. This works even when the
 * mirror refuses HEAD requests or omits Content-Length, which is exactly when the plain
 * size comparison silently accepts a truncated download.
 *
 * Only a single byte is requested: it answers the same question as an open-ended range while
 * keeping the response small enough to drain, so the connection stays reusable.
 */
export async function probeRemoteCompletion(
  url: string,
  localSize: number,
  options: DownloadOptions
): Promise<RemoteFileProbe> {
  const offset = Math.max(localSize, 0);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: createDownloadHeaders({ Range: `bytes=${offset}-${offset}` }),
      signal: getRequestTimeoutSignal(options),
    });
    await response.arrayBuffer();

    return interpretProbeResponse(response, localSize);
  } catch {
    return UNKNOWN_PROBE;
  }
}

function interpretProbeResponse(response: Response, localSize: number): RemoteFileProbe {
  if (isUnavailableResponse(response)) return UNKNOWN_PROBE;

  const validator = getRangeValidator(response);
  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);

  // A 416 means the requested offset is at or past the end of the resource, so the local file
  // cannot be missing any bytes. visuales' Apache omits Content-Range here, and without a total
  // we simply cannot tell "exactly complete" from "longer than the remote file" - but neither
  // is the truncation this module guards against, so the file is accepted.
  if (response.status === 416) {
    const totalSize = parseContentRangeTotal(response);

    return {
      known: true,
      complete: totalSize === 0 || localSize === totalSize,
      totalSize,
      acceptsRanges: true,
      validator,
    };
  }

  // A 206, on the other hand, proves bytes follow the offset. Calling that complete because the
  // total is missing is exactly the silent truncation this module exists to prevent.
  if (response.status === 206) {
    const totalSize = parseContentRangeTotal(response);
    if (totalSize === 0) return UNKNOWN_PROBE;

    return {
      known: true,
      complete: localSize >= totalSize,
      totalSize,
      acceptsRanges: true,
      validator,
    };
  }

  // The server ignored Range and answered with the whole representation.
  if (response.ok) {
    if (!Number.isFinite(contentLength) || contentLength <= 0) return UNKNOWN_PROBE;

    return {
      known: true,
      complete: localSize === contentLength,
      totalSize: contentLength,
      acceptsRanges: false,
      validator,
    };
  }

  return UNKNOWN_PROBE;
}

/**
 * Confirms a finished download against the server and pulls in whatever is still missing.
 * Runs before the file is promoted out of the parts directory, so a truncated transfer can
 * never reach the output directory reported as complete.
 */
export async function verifyDownloadedFile(request: VerifyDownloadRequest): Promise<VerifyDownloadResult> {
  const { url, filePath, options, expectedFileSize, onStatus, onProgress, log } = request;
  let localSize = await getFileSize(filePath);

  if (localSize === null) {
    throw new Error("Download finished but file is missing");
  }

  await assertNotUnavailablePage(filePath);

  if (expectedFileSize.exact && localSize === expectedFileSize.size) {
    return { size: localSize, totalSize: expectedFileSize.size, verified: true, repairedBytes: 0 };
  }

  const maxPasses = Math.max(1, options.maxRetries + 1);
  let repairedBytes = 0;

  for (let pass = 1; pass <= maxPasses; pass++) {
    onStatus?.("Verifying");
    const probe = await probeRemoteCompletion(url, localSize, options);

    if (!probe.known) {
      return finishUnverified(filePath, localSize, expectedFileSize, repairedBytes);
    }

    if (probe.totalSize > 0 && localSize > probe.totalSize) {
      await fs.rm(filePath, { force: true });
      throw new Error(
        `Downloaded file is ${formatSize(localSize)} but the remote file is ${formatSize(
          probe.totalSize
        )}; discarded the corrupted download`
      );
    }

    if (probe.complete) {
      return { size: localSize, totalSize: probe.totalSize || localSize, verified: true, repairedBytes };
    }

    // Without range support the only way to complete the file is to fetch it again from scratch.
    if (probe.acceptsRanges) {
      log?.(
        `missing ${formatSize(probe.totalSize - localSize)} of ${formatSize(
          probe.totalSize
        )}; downloading the remainder`
      );
      onStatus?.("Repairing");
    } else {
      log?.(
        `incomplete (${formatSize(localSize)} of ${formatSize(
          probe.totalSize
        )}) and the server does not support resuming; downloading it again`
      );
      onStatus?.("Restarting");
      await fs.rm(filePath, { force: true });
      localSize = 0;
    }

    const result = await downloadWithFetch({
      url,
      tempPath: filePath,
      options,
      expectedFileSize: { size: probe.totalSize, exact: true },
      validator: probe.validator,
      forceResume: probe.acceptsRanges,
      onProgress,
    });

    await assertNotUnavailablePage(filePath);
    const repairedSize = (await getFileSize(filePath)) ?? 0;

    if (result.resumed && repairedSize <= localSize) {
      throw new Error(
        `Download stalled at ${formatSize(repairedSize)} of ${formatSize(probe.totalSize)} while repairing`
      );
    }

    if (result.resumed) {
      repairedBytes += Math.max(repairedSize - localSize, 0);
    }
    localSize = repairedSize;

    if (probe.totalSize > 0 && localSize === probe.totalSize) {
      return { size: localSize, totalSize: probe.totalSize, verified: true, repairedBytes };
    }
  }

  await fs.rm(filePath, { force: true });
  throw new Error(
    `Download is still incomplete after ${maxPasses} repair attempt${maxPasses === 1 ? "" : "s"}; discarded the partial file`
  );
}

async function assertNotUnavailablePage(filePath: string): Promise<void> {
  if (!(await isUnavailablePageFile(filePath))) return;

  await fs.rm(filePath, { force: true });
  throw new Error("Download returned the visuales unavailable-page response; retry later");
}

/**
 * Fallback for mirrors that disclose nothing usable: keep the pre-existing size check so the
 * download is not blocked, but flag the result as unverified.
 */
async function finishUnverified(
  filePath: string,
  localSize: number,
  expectedFileSize: ExpectedFileSize,
  repairedBytes: number
): Promise<VerifyDownloadResult> {
  if (expectedFileSize.exact && localSize !== expectedFileSize.size) {
    await fs.rm(filePath, { force: true });
    throw new Error(
      `Download finished but file size is ${formatSize(localSize)}; expected ${formatSize(expectedFileSize.size)}`
    );
  }

  return { size: localSize, totalSize: expectedFileSize.size, verified: false, repairedBytes };
}
