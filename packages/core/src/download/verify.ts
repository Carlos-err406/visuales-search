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
  /** Exact length advertised by the transfer response, if available. */
  transferSize?: number;
  onStatus?: (status: string) => void;
  onProgress?: (progress: FetchDownloadProgress) => void;
  log?: (message: string) => void;
}

export interface VerifyDownloadResult {
  size: number;
  /** Exact remote size confirmed by the server. */
  totalSize: number;
  /** True when the server confirmed the file is whole. */
  verified: true;
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
 * A 416 proves completion only when Content-Range's total matches the local size, while a
 * valid 206 proves bytes are still missing and supplies the real total. This works even when the
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
    // Never buffer an entire movie when a server ignores the one-byte Range request.
    if (response.status === 206 && response.headers.get("content-length") === "1") await response.arrayBuffer();
    else await response.body?.cancel();

    return interpretProbeResponse(response, localSize);
  } catch {
    return UNKNOWN_PROBE;
  }
}

function interpretProbeResponse(response: Response, localSize: number): RemoteFileProbe {
  const validator = getRangeValidator(response);
  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);

  // Without a total, 416 cannot distinguish a whole file from an oversized/corrupt one.
  if (response.status === 416) {
    if (!/^bytes \*\/\d+$/i.test(response.headers.get("content-range") ?? "")) return UNKNOWN_PROBE;
    const totalSize = parseContentRangeTotal(response);
    if (!Number.isSafeInteger(totalSize) || totalSize <= 0) return UNKNOWN_PROBE;

    return {
      known: true,
      complete: localSize === totalSize,
      totalSize,
      acceptsRanges: true,
      validator,
    };
  }

  if (isUnavailableResponse(response)) return UNKNOWN_PROBE;

  // A 206, on the other hand, proves bytes follow the offset. Calling that complete because the
  // total is missing is exactly the silent truncation this module exists to prevent.
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get("content-range") ?? "");
    if (!range) return UNKNOWN_PROBE;
    const [start, end, totalSize] = range.slice(1).map(Number);
    if (
      ![start, end, totalSize].every(Number.isSafeInteger) ||
      start !== localSize ||
      end !== start ||
      totalSize <= end
    )
      return UNKNOWN_PROBE;

    return {
      known: true,
      complete: false,
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
  const { url, filePath, options, expectedFileSize, transferSize, onStatus, onProgress, log } = request;
  let localSize = await getFileSize(filePath);

  if (localSize === null) {
    throw new Error("Download finished but file is missing");
  }

  await assertNotUnavailablePage(filePath);

  // Conflicting HEAD/probe and transfer lengths must go through the server check below.
  const conflictingSize =
    transferSize !== undefined && expectedFileSize.exact && transferSize !== expectedFileSize.size;
  const confirmedSize = transferSize ?? (expectedFileSize.exact ? expectedFileSize.size : undefined);
  if (!conflictingSize && confirmedSize !== undefined && localSize === confirmedSize) {
    return { size: localSize, totalSize: confirmedSize, verified: true, repairedBytes: 0 };
  }

  const maxRepairs = Math.max(1, options.maxRetries + 1);
  let repairedBytes = 0;

  for (let pass = 0; pass <= maxRepairs; pass++) {
    onStatus?.("Verifying");
    const probe = await probeRemoteCompletion(url, localSize, options);

    if (!probe.known) {
      throw new Error(
        `Could not verify download completion (${formatSize(localSize)} saved` +
          `${expectedFileSize.exact ? `; expected ${formatSize(expectedFileSize.size)}` : ""}). ` +
          "The server did not provide a reliable file size. Partial file kept; retry later."
      );
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

    if (pass === maxRepairs) break;

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

    if ((result.exactSize === undefined || result.exactSize === probe.totalSize) && localSize === probe.totalSize) {
      return { size: localSize, totalSize: probe.totalSize, verified: true, repairedBytes };
    }
  }

  await fs.rm(filePath, { force: true });
  throw new Error(
    `Download is still incomplete after ${maxRepairs} repair attempt${maxRepairs === 1 ? "" : "s"}; discarded the partial file`
  );
}

async function assertNotUnavailablePage(filePath: string): Promise<void> {
  if (!(await isUnavailablePageFile(filePath))) return;

  await fs.rm(filePath, { force: true });
  throw new Error("Download returned the visuales unavailable-page response; retry later");
}
