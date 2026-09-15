import { fetchHtml, parseHtml } from "./lib/html-parser.js";
import { saveSearchAliases } from "./lib/cache.js";
import { libraryUrl, listLibraryDirectory } from "./library.js";
import { canonicalTreeUrl } from "./search-tree.js";

export async function searchContent(terms: string[], options: { noCache?: boolean; root?: string } = {}) {
  const root = options.root === undefined ? undefined : canonicalTreeUrl(libraryUrl(options.root).href);
  if (root && !root.endsWith("/")) throw new Error("Search root must be a directory");
  const html = await fetchHtml(options);
  const index = parseHtml(html, []);
  let allResults = index;
  if (root) {
    const branch = index.filter((entry) => {
      const url = canonicalTreeUrl(entry.encodedUrl);
      return url !== root && url.startsWith(root);
    });
    // listado indexes folders; include the root's actual files without crawling unrelated branches.
    const children = await listLibraryDirectory(root, options.noCache);
    const entries = new Map(branch.map((entry) => [canonicalTreeUrl(entry.encodedUrl), entry]));
    for (const entry of children) entries.set(canonicalTreeUrl(entry.encodedUrl), entry);
    allResults = [...entries.values()];
  }
  const results = terms.length
    ? allResults.filter((entry) =>
        terms.every((term) =>
          `${entry.text} ${entry.url} ${entry.encodedUrl}`.toLowerCase().includes(term.toLowerCase())
        )
      )
    : allResults;
  const aliases = await saveSearchAliases([...index, ...allResults].map((result) => result.encodedUrl));
  for (const result of [...allResults, ...results]) result.downloadId = aliases.get(result.encodedUrl);
  return { results, allResults, totalResults: results.length };
}
