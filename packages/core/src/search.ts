import { fetchHtml, parseHtml } from "./lib/html-parser.js";
import { saveSearchAliases } from "./lib/cache.js";

export async function searchContent(terms: string[], options: { noCache?: boolean } = {}) {
  const html = await fetchHtml(options);
  const allResults = parseHtml(html, []);
  const results = parseHtml(html, terms);
  const aliases = await saveSearchAliases(allResults.map((result) => result.encodedUrl));
  for (const result of [...allResults, ...results]) result.downloadId = aliases.get(result.encodedUrl);
  return { results, allResults, totalResults: results.length };
}
