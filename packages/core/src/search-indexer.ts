import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import robotsParser from "robots-parser";
import { CONFIG } from "./lib/types.js";
import { readJson, writeJson } from "./lib/cache-io.js";
import { setCachedHtml, registerFileIndexCache } from "./lib/cache.js";
import { parseHtml } from "./lib/html-parser.js";
import type { DirectoryListing } from "./download/discovery-cache.js";
import {
  fetchLibraryListing,
  fetchLibraryResource,
  libraryBrowsingBusy,
  libraryUrl,
  LibraryRequestError,
} from "./library-listing.js";
import {
  fileIndexDirectory,
  fileIndexGeneration,
  fileIndexRevision,
  withFileIndexLock,
  readFileIndex,
  cachedIndexedDirectory,
  publishIndexedDirectory,
  indexDirectoryRemoved,
} from "./search-file-index.js";
import type { SearchIndexAction, SearchIndexPhase, SearchIndexStatus } from "./search-index-types.js";

const DAY = 86400000;
export const FILE_INDEX_MAX_AGE = 7 * DAY;
const ORIGIN = "https://visuales.uclv.cu";
const AGENT = "VisualesIndexer";
const statePath = () => path.join(fileIndexDirectory(), "scan.json");
const ownerPath = () => path.join(CONFIG.CACHE_DIR, "file-index-owner");
const controllers = new Set<AbortController>();

interface ScanState {
  generation: string;
  run: string;
  paused: boolean;
  phase: SearchIndexPhase;
  queue: string[];
  cursor: number;
  errors: Record<string, { message: string; retryAt: number }>;
  skipped: string[];
  startedAt: number;
  forceSince: number;
  retryAt?: number;
  current?: string;
  error?: string;
  lastUpdated?: number;
}

async function loadState(generation: string): Promise<ScanState> {
  const state = await readJson<ScanState>(statePath());
  if (
    state?.generation === generation &&
    Array.isArray(state.queue) &&
    Number.isSafeInteger(state.cursor) &&
    state.errors &&
    Array.isArray(state.skipped)
  )
    return state;
  return {
    generation,
    run: randomUUID(),
    paused: false,
    phase: "idle",
    queue: [],
    cursor: 0,
    errors: {},
    skipped: [],
    startedAt: 0,
    forceSince: 0,
  };
}

async function mutateState(generation: string, operation: (state: ScanState) => void, run?: string) {
  return withFileIndexLock(async () => {
    const meta = await readJson<{ generation: string }>(path.join(fileIndexDirectory(), "meta.json"));
    if (meta?.generation !== generation) return undefined;
    const state = await loadState(generation);
    if (run && run !== state.run) return undefined;
    operation(state);
    await writeJson(statePath(), state);
    return state;
  });
}

export async function controlSearchIndex(action: SearchIndexAction): Promise<SearchIndexStatus> {
  if (!["pause", "resume", "refresh"].includes(action)) throw new Error("Unknown indexing action");
  const generation = await fileIndexGeneration();
  await mutateState(generation, (state) => {
    if (action === "pause") {
      state.paused = true;
      state.phase = "paused";
    } else if (action === "resume") {
      state.paused = false;
      state.phase = "idle";
      state.retryAt = undefined;
      for (const error of Object.values(state.errors)) error.retryAt = 0;
    } else {
      state.run = randomUUID();
      state.queue = [];
      state.cursor = 0;
      state.errors = {};
      state.skipped = [];
      state.startedAt = 0;
      state.forceSince = Date.now();
      state.retryAt = undefined;
      state.phase = state.paused ? "paused" : "idle";
    }
    state.current = undefined;
    state.error = undefined;
  });
  for (const controller of controllers) controller.abort();
  return getSearchIndexStatus();
}

export async function getSearchIndexStatus(): Promise<SearchIndexStatus> {
  const index = await readFileIndex();
  const state = await loadState(index.meta.generation);
  const running = await lockfile.check(ownerPath(), { realpath: false, stale: 10000 });
  const list = await fs.stat(CONFIG.CACHE_FILE).catch(() => undefined);
  let files = 0;
  for (const directory of index.directories.values())
    files += directory.entries.filter((entry) => !entry.isDirectoryLink).length;
  return {
    phase: state.paused ? "paused" : !running && ["indexing", "waiting"].includes(state.phase) ? "idle" : state.phase,
    files,
    completed: Math.max(0, state.cursor - Object.keys(state.errors).length - state.skipped.length),
    total: state.queue.length,
    failed: Object.keys(state.errors).length,
    skipped: state.skipped.length,
    running,
    libraryRevision: list ? `${list.mtimeMs}:${list.size}` : undefined,
    revision: fileIndexRevision(index),
    current: state.current,
    lastUpdated: state.lastUpdated,
    error: state.error,
    retryAt: state.retryAt,
  };
}

export function indexSeedUrls(urls: string[]): string[] {
  const queue = new Set<string>();
  for (const value of urls) {
    try {
      const url = libraryUrl(value).href;
      if (url.endsWith("/")) queue.add(url);
    } catch {
      /* Unsupported links are never crawl targets. */
    }
  }
  for (const value of [...queue]) {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) queue.add(`${url.origin}/${parts.slice(0, i).join("/")}/`);
  }
  queue.add(`${ORIGIN}/`);
  return [...queue];
}

async function loadSeeds(signal: AbortSignal): Promise<string[]> {
  const cached = await readJson<{ html: string; timestamp: number }>(CONFIG.CACHE_FILE);
  let html = cached?.html;
  if (!html || Date.now() - (cached?.timestamp ?? 0) > DAY) {
    try {
      const response = await fetchLibraryResource(CONFIG.TARGET_URL, 32 * 1024 * 1024, signal, `${AGENT}/1.0`);
      const fresh = await response.text();
      if (!parseHtml(fresh, []).some((entry) => entry.isDirectoryLink))
        throw new Error("Search index contained no directories");
      await setCachedHtml(fresh);
      html = fresh;
    } catch (error) {
      if (!html || signal.aborted) throw error;
    }
  }
  return indexSeedUrls(
    parseHtml(html, [])
      .filter((entry) => entry.isDirectoryLink)
      .map((entry) => entry.encodedUrl)
  );
}

async function crawlPolicy(signal: AbortSignal) {
  const file = path.join(fileIndexDirectory(), "robots.json");
  let cached = await readJson<{ text: string; checkedAt: number }>(file);
  if (!cached || Date.now() - cached.checkedAt > DAY) {
    let text: string;
    try {
      text = await (await fetchLibraryResource(`${ORIGIN}/robots.txt`, 512 * 1024, signal, `${AGENT}/1.0`)).text();
    } catch (error) {
      if (!(error instanceof LibraryRequestError) || ![404, 410].includes(error.status)) throw error;
      text = "";
    }
    cached = { text, checkedAt: Date.now() };
    await writeJson(file, cached);
  }
  const policy = robotsParser(`${ORIGIN}/robots.txt`, cached.text);
  return {
    allowed: (url: string) => policy.isAllowed(url, AGENT) === true,
    delay: (policy.getCrawlDelay(AGENT) ?? 0) * 1000,
  };
}

interface IndexerOptions {
  signal: AbortSignal;
  continuous?: boolean;
  onChange?: () => void;
  onAcquired?: () => void;
  // Inject the boundaries for fixture-based tests; production always uses the shared engine.
  seeds?: (signal: AbortSignal) => Promise<string[]>;
  listing?: (url: string, signal: AbortSignal) => Promise<DirectoryListing>;
  policy?: (signal: AbortSignal) => Promise<{ allowed: (url: string) => boolean; delay: number }>;
  busy?: () => Promise<boolean>;
  interval?: number;
}

export async function runSearchIndexer(options: IndexerOptions): Promise<void> {
  const { signal } = options;
  await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
  let release: (() => Promise<void>) | undefined;
  let compromised = false;
  try {
    release = await lockfile.lock(ownerPath(), {
      realpath: false,
      stale: 10000,
      update: 2000,
      retries: 0,
      onCompromised: () => {
        compromised = true;
        for (const controller of controllers) controller.abort();
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") return;
    throw error;
  }
  const pause = (ms: number) => sleep(ms, undefined, { signal }).catch(() => {});
  options.onAcquired?.();
  let failures = 0;
  let policy: Awaited<ReturnType<typeof crawlPolicy>> | undefined;
  let policyAt = 0;
  try {
    await registerFileIndexCache();
    await readFileIndex();
    while (!signal.aborted && !compromised) {
      const generation = await fileIndexGeneration();
      let state = await loadState(generation);
      if ((await readJson<ScanState>(statePath()))?.generation !== generation)
        state = (await mutateState(generation, () => {})) ?? state;
      if (state.paused) {
        if (!options.continuous) return;
        await pause(1000);
        continue;
      }
      if (state.retryAt && state.retryAt > Date.now()) {
        if (!options.continuous && state.cursor >= state.queue.length && state.queue.length) return;
        await pause(Math.min(1000, state.retryAt - Date.now()));
        continue;
      }
      const busy = options.busy ?? libraryBrowsingBusy;
      const workDue =
        !state.startedAt ||
        state.cursor < state.queue.length ||
        Object.values(state.errors).some((error) => error.retryAt <= Date.now()) ||
        (!Object.keys(state.errors).length && Date.now() - state.startedAt >= DAY);
      if (workDue && (await busy())) {
        await mutateState(
          generation,
          (next) => {
            next.phase = "waiting";
            next.current = undefined;
          },
          state.run
        );
        options.onChange?.();
        await pause(1000);
        continue;
      }
      if (workDue && state.phase !== "indexing") {
        const next = await mutateState(
          generation,
          (next) => {
            next.phase = "indexing";
            next.current = undefined;
          },
          state.run
        );
        if (!next) continue;
        state = next;
        options.onChange?.();
      }
      const request = new AbortController();
      const abort = () => request.abort();
      signal.addEventListener("abort", abort, { once: true });
      controllers.add(request);
      // Commands from another process must cancel a slow request promptly too.
      const monitor = setInterval(() => {
        void readJson<ScanState>(statePath())
          .then((latest) => {
            if (!latest || latest.paused || latest.run !== state.run || latest.generation !== generation)
              request.abort();
          })
          .catch(() => request.abort());
      }, 500);
      let target: string | undefined;
      try {
        if (!policy || Date.now() - policyAt > DAY) {
          policy = await (options.policy ?? crawlPolicy)(request.signal);
          policyAt = Date.now();
        }
        if (
          !state.startedAt ||
          (state.cursor >= state.queue.length &&
            !Object.keys(state.errors).length &&
            Date.now() - state.startedAt >= DAY)
        ) {
          if (!options.seeds && !policy.allowed(CONFIG.TARGET_URL))
            throw new Error("The server does not allow indexing listado.html");
          const queue = await (options.seeds ?? loadSeeds)(request.signal);
          const next = await mutateState(
            generation,
            (next) => {
              next.queue = [...new Set(queue)];
              next.cursor = 0;
              next.errors = {};
              next.skipped = [];
              next.startedAt = Date.now();
              next.phase = "indexing";
            },
            state.run
          );
          if (!next) continue;
          state = next;
        }
        const retry = Object.entries(state.errors).find(([, error]) => error.retryAt <= Date.now())?.[0];
        target = state.queue[state.cursor] ?? retry;
        if (!target) {
          await mutateState(
            generation,
            (next) => {
              next.phase = Object.keys(next.errors).length || next.skipped.length ? "partial" : "complete";
              next.current = undefined;
              if (next.phase === "complete") next.lastUpdated ??= Date.now();
            },
            state.run
          );
          options.onChange?.();
          if (!options.continuous) return;
          await pause(1000);
          continue;
        }
        const url = libraryUrl(target).href;
        await mutateState(
          generation,
          (next) => {
            next.phase = "indexing";
            next.current = url;
          },
          state.run
        );
        options.onChange?.();
        let children: string[] = [];
        let skipped = false;
        if (!policy.allowed(url) || (await indexDirectoryRemoved(url, state.startedAt))) skipped = true;
        else {
          const cached = await cachedIndexedDirectory(url);
          if (cached && cached.fetchedAt >= state.forceSince && Date.now() - cached.fetchedAt < FILE_INDEX_MAX_AGE) {
            children = cached.entries.filter((entry) => entry.isDirectoryLink).map((entry) => entry.encodedUrl);
          } else {
            const started = Date.now();
            const listing = await (options.listing ?? ((url, signal) => fetchLibraryListing(url, signal, true)))(
              url,
              request.signal
            );
            if (request.signal.aborted || signal.aborted || compromised) continue;
            const latest = await loadState(generation);
            if (latest.paused || latest.run !== state.run) continue;
            if (!(await publishIndexedDirectory(url, listing, started, generation))) continue;
            children =
              (await cachedIndexedDirectory(url))?.entries
                .filter((entry) => entry.isDirectoryLink)
                .map((entry) => entry.encodedUrl) ?? [];
            await sleep(Math.max(options.interval ?? 1000, policy.delay), undefined, { signal: request.signal }).catch(
              () => {}
            );
          }
        }
        if (request.signal.aborted || compromised) continue;
        await mutateState(
          generation,
          (next) => {
            if (next.queue[next.cursor] === url) next.cursor++;
            delete next.errors[url];
            if (skipped && !next.skipped.includes(url)) next.skipped.push(url);
            const known = new Set(next.queue);
            for (const child of children)
              if (!known.has(child)) {
                known.add(child);
                next.queue.push(child);
              }
            next.error = undefined;
            next.retryAt = undefined;
            next.current = undefined;
            if (next.cursor === next.queue.length && !Object.keys(next.errors).length && !next.skipped.length)
              next.lastUpdated = Date.now();
          },
          state.run
        );
        failures = 0;
        options.onChange?.();
      } catch (error) {
        if (request.signal.aborted || signal.aborted || compromised) continue;
        failures++;
        const message = error instanceof Error ? error.message : String(error);
        const retryAt = Math.max(
          Date.now() + Math.min(300000, 2000 * 2 ** Math.min(failures, 8)),
          error instanceof LibraryRequestError ? error.retryAt || 0 : 0
        );
        await mutateState(
          generation,
          (next) => {
            next.phase = "offline";
            next.error = message;
            next.retryAt = retryAt;
            next.current = undefined;
            if (target) {
              if (next.queue[next.cursor] === target) next.cursor++;
              next.errors[target] = {
                message,
                retryAt:
                  error instanceof LibraryRequestError && [403, 404].includes(error.status)
                    ? Date.now() + DAY
                    : retryAt,
              };
            }
          },
          state.run
        );
        options.onChange?.();
        if (!options.continuous && !target) return;
      } finally {
        clearInterval(monitor);
        controllers.delete(request);
        signal.removeEventListener("abort", abort);
      }
    }
  } finally {
    await release().catch(() => {});
    options.onChange?.();
  }
}
