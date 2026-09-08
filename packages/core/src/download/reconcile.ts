import fs from "fs/promises";
import path from "path";
import { DownloadOptions } from "./types.js";
import { type ExistingFileState, getFileSize } from "./file-state.js";
import { probeRemoteCompletion } from "./verify.js";

export type ReconcileDecision =
  | { action: "skip"; totalSize: number }
  | { action: "resume"; localSize: number; totalSize: number; validator?: string }
  | { action: "restart"; reason: string };

export interface ReconcileRequest {
  url: string;
  finalPath: string;
  tempPath: string;
  existing: ExistingFileState;
  options: DownloadOptions;
}

/**
 * Decides what to do with a file that is already in the output directory.
 *
 * A partial file left behind by an earlier run is moved back into the parts directory so the
 * transfer continues from where it stopped, instead of downloading the whole file again.
 */
export async function reconcileExistingFile(request: ReconcileRequest): Promise<ReconcileDecision> {
  const { url, finalPath, tempPath, existing, options } = request;

  if (existing.isUnavailablePage) {
    await fs.rm(finalPath, { force: true });
    return { action: "restart", reason: "Existing file is an unavailable-page response" };
  }

  const probe = await probeRemoteCompletion(url, existing.size, options);

  if (!probe.known) {
    return { action: "restart", reason: "Existing file is incomplete or unverified" };
  }

  if (probe.complete) {
    return { action: "skip", totalSize: probe.totalSize || existing.size };
  }

  if (probe.totalSize > 0 && existing.size > probe.totalSize) {
    await fs.rm(finalPath, { force: true });
    return { action: "restart", reason: "Existing file is larger than the remote file" };
  }

  if (!probe.acceptsRanges) {
    await fs.rm(finalPath, { force: true });
    return { action: "restart", reason: "Existing file is incomplete and the server does not support resuming" };
  }

  if (!options.resume) {
    await fs.rm(finalPath, { force: true });
    return { action: "restart", reason: "Existing file is incomplete and resuming is disabled" };
  }

  const localSize = await seedPartsFile(finalPath, tempPath, existing.size);

  return { action: "resume", localSize, totalSize: probe.totalSize, validator: probe.validator };
}

/**
 * Moves the partial output file into the parts directory, keeping whichever copy already holds
 * more bytes. The rename stays inside the output directory, so it is atomic.
 */
async function seedPartsFile(finalPath: string, tempPath: string, existingSize: number): Promise<number> {
  const tempSize = (await getFileSize(tempPath)) ?? 0;

  if (tempSize >= existingSize) {
    await fs.rm(finalPath, { force: true });
    return tempSize;
  }

  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  await fs.rm(tempPath, { force: true });
  await fs.rename(finalPath, tempPath);

  return existingSize;
}
