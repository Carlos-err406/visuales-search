import * as cheerio from "cheerio";
import colors from "ansi-colors";
import { type SearchResult } from "./types.js";

interface FetchHtmlOptions {
  noCache?: boolean;
}

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

function decodeBytes(bytes: number[]): string {
  const buffer = Buffer.from(bytes);
  const utf8 = buffer.toString("utf8");

  return utf8.includes("�") ? buffer.toString("latin1") : utf8;
}

function decodePercentEncodedPath(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "%" || !/^[\dA-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      decoded += value[index];
      continue;
    }

    const bytes: number[] = [];

    while (value[index] === "%" && /^[\dA-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      bytes.push(parseInt(value.slice(index + 1, index + 3), 16));
      index += 3;
    }

    decoded += decodeBytes(bytes);
    index--;
  }

  return decoded;
}

function decodePathname(pathname: string): string {
  let decoded = pathname;

  for (let pass = 0; pass < 2; pass++) {
    const next = decodePercentEncodedPath(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  return normalizeAccentedWordCase(decoded.replace(/\/+/g, "/"));
}

function normalizeAccentedWordCase(value: string): string {
  const lowercaseAccents: Record<string, string> = {
    Á: "á",
    É: "é",
    Í: "í",
    Ó: "ó",
    Ú: "ú",
    Ü: "ü",
    Ñ: "ñ",
  };

  return value.replace(/(?<=[a-z])([ÁÉÍÓÚÜÑ])(?=[a-z])/g, (match) => lowercaseAccents[match] ?? match);
}

function getNameFromPath(pathname: string): string {
  const trimmedPathname = pathname.replace(/\/+$/, "");
  const lastSlashIndex = trimmedPathname.lastIndexOf("/");

  return lastSlashIndex >= 0 ? trimmedPathname.slice(lastSlashIndex + 1) : trimmedPathname;
}

function getDisplayText(text: string, decodedPathname: string): string {
  return text.includes("�") ? getNameFromPath(decodedPathname) : text;
}

function matchesSearchTerms(text: string, url: string, searchTerms: string[]): boolean {
  const combinedContent = `${text.toLowerCase()} ${url.toLowerCase()}`;

  return searchTerms.every((term) => combinedContent.includes(term.toLowerCase()));
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
    const decodedPathname = decodePathname(urlObj.pathname);
    const displayText = getDisplayText(text, decodedPathname);

    const normalizedUrl = `${urlObj.origin}${decodedPathname}${urlObj.search}`;
    const encodedUrl = `${urlObj.origin}${urlObj.pathname.replace(/\/+/g, "/")}${urlObj.search}`;

    const isDirectoryLink = href.endsWith("/");
    const directory = getDirectoryFromPath(decodedPathname);

    if (seenUrls.has(normalizedUrl)) {
      return;
    }

    seenUrls.add(normalizedUrl);

    if (isDirectoryLink && !seenDirectories.has(directory)) {
      seenDirectories.add(directory);
    }

    if (searchTerms.length === 0 || matchesSearchTerms(displayText, `${normalizedUrl} ${encodedUrl}`, searchTerms)) {
      results.push({
        url: normalizedUrl,
        text: displayText,
        directory,
        encodedUrl,
        isDirectoryLink,
      });
    }
  });

  return results;
}

export async function fetchHtml(options: FetchHtmlOptions = {}): Promise<string> {
  if (!options.noCache) {
    const cached = await import("./cache.js").then((m) => m.getCachedHtml());
    if (cached) {
      return cached;
    }
  } else {
    console.log(colors.gray("↻ Bypassing cached search data"));
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
