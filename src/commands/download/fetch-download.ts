import fs from "fs/promises";
import path from "path";
import { DownloadOptions } from "./types.js";
import {
  createDownloadHeaders,
  ExpectedFileSize,
  getRequestTimeoutSignal,
  isUnavailableResponse,
  parseContentRangeStart,
} from "./http.js";
import { getFileSize } from "./file-state.js";

export interface FetchDownloadProgress {
  downloadedBytes: number;
  speedBytes: number;
  percentage: number;
  totalBytes: number;
}

export interface FetchDownloadRequest {
  url: string;
  tempPath: string;
  options: DownloadOptions;
  expectedFileSize: ExpectedFileSize;
  /** ETag/Last-Modified sent as If-Range so the server rejects a stale resume with a full 200. */
  validator?: string;
  /** Resume even when --resume is off; used by the post-download repair pass. */
  forceResume?: boolean;
  onProgress?: (progress: FetchDownloadProgress) => void;
}

export interface FetchDownloadResult {
  downloadedBytes: number;
  totalBytes: number;
  resumed: boolean;
}

export async function downloadWithFetch(request: FetchDownloadRequest): Promise<FetchDownloadResult> {
  const { url, tempPath, options, expectedFileSize, validator, forceResume, onProgress } = request;
  const canResume = options.resume || forceResume === true;
  const existingBytes = canResume ? ((await getFileSize(tempPath)) ?? 0) : 0;
  const rangeHeaders =
    existingBytes > 0
      ? { Range: `bytes=${existingBytes}-`, ...(validator ? { "If-Range": validator } : {}) }
      : undefined;
  const headers = createDownloadHeaders(rangeHeaders);

  const response = await fetch(url, {
    headers,
    signal: getRequestTimeoutSignal(options),
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed: ${response.statusText} (${response.status})`);
  }

  const shouldAppend = existingBytes > 0 && response.status === 206;

  // Appending assumes the response continues exactly where the file on disk ends. A range that
  // starts anywhere else would produce a file of the right length holding shifted bytes, which
  // no size check can catch.
  if (shouldAppend) {
    const rangeStart = parseContentRangeStart(response);
    if (rangeStart !== existingBytes) {
      throw new Error(
        `Server resumed at byte ${rangeStart ?? "unknown"} instead of ${existingBytes}; refusing to append`
      );
    }
  }
  const startingBytes = shouldAppend ? existingBytes : 0;
  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
  const totalBytes = expectedFileSize.size || (response.status === 206 ? startingBytes + contentLength : contentLength);

  if (isUnavailableResponse(response)) {
    throw new Error("Download returned the visuales unavailable-page response; retry later");
  }

  if (!response.body) {
    throw new Error("Download response did not include a readable body");
  }

  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  const file = await fs.open(tempPath, shouldAppend ? "a" : "w");
  const startedAt = Date.now();
  let downloadedBytes = startingBytes;

  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      await file.write(buffer);
      downloadedBytes += buffer.length;
      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
      const speedBytes = (downloadedBytes - startingBytes) / elapsedSeconds;
      const percentage = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

      onProgress?.({
        downloadedBytes,
        speedBytes,
        percentage,
        totalBytes,
      });
    }
  } finally {
    await file.close();
  }

  return {
    downloadedBytes,
    totalBytes,
    resumed: shouldAppend,
  };
}
