import * as cheerio from "cheerio";
import colors from "ansi-colors";
import { type SearchResult } from "./types.js";

function getDirectoryFromPath(pathname: string): string {
  if (pathname === "/" || pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  const lastSlashIndex = pathname.lastIndexOf("/");
  if (lastSlashIndex === 0) {
    return pathname;
  }

  return pathname.slice(0, lastSlashIndex);
}

function matchesSearchTerms(
  text: string,
  url: string,
  searchTerms: string[]
): boolean {
  const combinedContent = `${text.toLowerCase()} ${url.toLowerCase()}`;

  return searchTerms.every((term) =>
    combinedContent.includes(term.toLowerCase())
  );
}

export function parseHtml(html: string, searchTerms: string[]): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  const seenDirectories = new Set<string>();

  $("a").each((_, element) => {
    const $element = $(element);
    const href = $element.attr("href");
    const text = $element.text().trim();

    if (!href) return;

    const urlObj = new URL(href);
    let decodedPathname = urlObj.pathname;

    try {
      decodedPathname = decodeURIComponent(decodeURIComponent(urlObj.pathname));
    } catch (e) {}

    decodedPathname = decodedPathname.replace(/\/+/g, "/");

    const normalizedUrl = `${urlObj.origin}${decodedPathname}${urlObj.search}`;

    const isDirectoryLink = href.endsWith("/");
    const directory = getDirectoryFromPath(decodedPathname);

    if (seenUrls.has(normalizedUrl)) {
      return;
    }

    seenUrls.add(normalizedUrl);

    if (isDirectoryLink && !seenDirectories.has(directory)) {
      seenDirectories.add(directory);
    }

    if (
      searchTerms.length === 0 ||
      matchesSearchTerms(text, normalizedUrl, searchTerms)
    ) {
      results.push({
        url: normalizedUrl,
        text,
        directory,
        encodedUrl: `${urlObj.origin}${urlObj.pathname.replace(/\/+/g, "/")}${
          urlObj.search
        }`,
        isDirectoryLink,
      });
    }
  });

  return results;
}

export async function fetchHtml(): Promise<string> {
  const cached = await import("./cache.js").then((m) => m.getCachedHtml());
  if (cached) {
    return cached;
  }

  console.log(colors.blue("🌐 Fetching HTML from visuales.uclv.cu..."));
  const response = await fetch("https://visuales.uclv.cu/listado.html");

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const html = await response.text();
  await import("./cache.js").then((m) => m.setCachedHtml(html));

  return html;
}
