import fs from "fs/promises";

export interface ExistingFileState {
  size: number;
  isUnavailablePage: boolean;
}

export async function getFileSize(filePath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

export async function getExistingFileState(filePath: string): Promise<ExistingFileState | null> {
  const size = await getFileSize(filePath);
  if (size === null) return null;

  return {
    size,
    isUnavailablePage: await isUnavailablePageFile(filePath),
  };
}

/**
 * visuales answers unavailable resources with a small HTML notice instead of a 404,
 * so a "successful" download can actually be that page saved under the media filename.
 */
export async function isUnavailablePageFile(filePath: string): Promise<boolean> {
  try {
    const file = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const sample = buffer.subarray(0, bytesRead).toString("utf8").toLowerCase();

      return (
        sample.includes("<html") &&
        (sample.includes("no est&aacute; disponible") ||
          sample.includes("no está disponible") ||
          sample.includes("upps") ||
          sample.includes("ayuda.uclv.edu.cu"))
      );
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}
