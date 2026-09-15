import fs from "node:fs/promises";
import path from "node:path";
import { listDownloadTasks } from "./download/tasks.js";
import { readDownloadFileDetails } from "./download/file-details.js";
import { canonicalTreeUrl } from "./search-tree.js";
import { libraryUrl } from "./library.js";

/** Reveal only a recorded completed file that still exists inside its task destination. */
export async function downloadedLibraryFile(value: string): Promise<string | null> {
  const url = canonicalTreeUrl(libraryUrl(value).href);
  for (const task of await listDownloadTasks()) {
    const sources = task.urls ?? [task.url];
    if (
      !sources.some((source) => {
        const canonical = canonicalTreeUrl(source);
        return canonical === url || (canonical.endsWith("/") && url.startsWith(canonical));
      })
    )
      continue;
    const details = await readDownloadFileDetails(task.id);
    for (const file of details?.files ?? []) {
      if (file.status !== "completed" || file.verified === false || canonicalTreeUrl(file.url) !== url) continue;
      const root = await fs.realpath(task.output).catch(() => null);
      if (!root) continue;
      const target = await fs.realpath(path.resolve(root, file.path)).catch(() => null);
      if (!target) continue;
      const relative = path.relative(root, target);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      if ((await fs.stat(target).catch(() => null))?.isFile()) return target;
    }
  }
  return null;
}
