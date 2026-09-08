import { DownloadOptions } from "./types.js";

export const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface ExpectedFileSize {
  size: number;
  exact: boolean;
}

/**
 * Headers shared by every transfer request. `Accept-Encoding: identity` matters: Content-Length
 * and Content-Range describe the encoded representation, so a compressed response would break
 * both the size comparison and the byte offsets a resumed range is built on.
 */
export function createDownloadHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "User-Agent": DOWNLOAD_USER_AGENT,
    "Accept-Encoding": "identity",
    ...extra,
  };
}

export function getRequestTimeoutSignal(options: DownloadOptions): AbortSignal | undefined {
  return Number.isFinite(options.timeout) ? AbortSignal.timeout(options.timeout * 1000) : undefined;
}

export function isUnavailableResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  return contentType.includes("text/html") && !response.url.toLowerCase().endsWith(".html");
}

/**
 * Reads the total resource length from a Content-Range header. Apache answers both
 * `bytes <start>-<end>/<total>` (206) and `bytes * /<total>` (416) with the total last.
 */
/** First byte offset of a Content-Range, or null when the header is absent or malformed. */
export function parseContentRangeStart(response: Response): number | null {
  const startText = response.headers.get("content-range")?.match(/bytes\s+(\d+)-/i)?.[1];
  const start = startText ? parseInt(startText, 10) : NaN;

  return Number.isFinite(start) ? start : null;
}

export function parseContentRangeTotal(response: Response): number {
  const contentRange = response.headers.get("content-range");
  const totalText = contentRange?.match(/\/(\d+)$/)?.[1];
  const total = totalText ? parseInt(totalText, 10) : 0;

  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Entity validator used for If-Range so a resumed request is rejected (200 instead of 206)
 * when the remote file changed since the range was negotiated.
 */
export function getRangeValidator(response: Response): string | undefined {
  return response.headers.get("etag") ?? response.headers.get("last-modified") ?? undefined;
}

function parseContentLength(response: Response): ExpectedFileSize {
  const contentLength = response.headers.get("content-length");
  const size = contentLength ? parseInt(contentLength, 10) : 0;
  const exact = response.ok && Number.isFinite(size) && size > 0 && !isUnavailableResponse(response);

  return {
    size: exact ? size : 0,
    exact,
  };
}

function parseContentRangeSize(response: Response): ExpectedFileSize {
  const size = parseContentRangeTotal(response);
  const exact = response.status === 206 && size > 0 && !isUnavailableResponse(response);

  return {
    size: exact ? size : 0,
    exact,
  };
}

export async function fetchExpectedFileSize(url: string, options: DownloadOptions): Promise<ExpectedFileSize> {
  const headers = createDownloadHeaders();

  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers,
      signal: getRequestTimeoutSignal(options),
    });
    const size = parseContentLength(response);
    if (size.exact) return size;
  } catch {
    // Fall through to a range request; some Apache mirrors omit useful HEAD metadata.
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: createDownloadHeaders({ Range: "bytes=0-0" }),
      signal: getRequestTimeoutSignal(options),
    });
    await response.body?.cancel();

    return parseContentRangeSize(response);
  } catch {
    return { size: 0, exact: false };
  }
}
