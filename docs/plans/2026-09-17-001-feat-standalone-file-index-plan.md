---
title: "feat: Automatically index library files for search"
type: feat
status: completed
date: 2026-09-17
origin: .context/compound-engineering/todos/016-complete-p3-standalone-file-search.md
---

# Automatically Index Library Files for Search

## Outcome

Search finds standalone files as well as folders, including `stuart fails` matching the episode in `/Recientes/`. Cached matches appear immediately. Desktop automatically fills the remaining file index in the background and shows its progress. CLI and desktop query the same shared-core index.

**Confirmed scope:** The user chose automatic indexing, not only cached folders or an opt-in full scan, and asked for visible indexing status. Index in parsed `listado.html` order, with no folder-specific priority or refresh policy. No implementation or release is authorized by this planning request.

**Proposed lifecycle:** Automatic indexing runs while desktop is running and resumes across launches. CLI gets an explicit foreground indexing command; ordinary CLI searches do not silently leave a background process. These are adapter lifecycle differences, not different matching rules or indexes.

## Requirements

- R1: Return known file matches immediately, alongside existing folder matches, through shared core.
- R2: Automatically discover files in unvisited folders across the library, without tying a crawl to each search.
- R3: Expose accurate coverage, indexing progress, pause/resume, failures, and freshness.
- R4: Preserve canonical URL identity, scoped-window boundaries, tree browsing, download aliases, and file actions.
- R5: Keep downloads and interactive browsing responsive; survive cancellation, offline use, crashes, and concurrent CLI/desktop processes.
- R6: Preserve user position and selection when an index update changes search results.

## Grounding

- `packages/core/src/search.ts` reads `listado.html` for global search. Scoped search also loads the root's immediate directory listing, but not cached descendant files.
- The backlog's inspected `listado.html` contained 29,955 folders and no files. This turn's read-only discovery-cache inspection found 397 directories and 12,049 unique file URLs in approximately 2.2 MB, including the requested Stuart Fails episode. These are local snapshot counts, not a current server inventory or a benchmark.
- `packages/core/src/download/discovery-cache.ts` stores directory snapshots with no fetch timestamps. `saveDiscoveryCache()` writes the entire process-local map; atomic rename prevents partial JSON but does not prevent one process overwriting another process's updates.
- `packages/core/src/download/downloader.ts:getDirectoryListing` already parses Apache `pre`/table listings, deduplicates URLs, and stores files and subfolders. Its parsing should be reused, not independently reimplemented.
- `packages/core/src/library.ts` validates Visuales URLs, bounds listing responses, and supports cached empty directories. Its current single listing queue must not put interactive requests behind a whole crawl.
- `packages/core/src/search-tree.ts:canonicalTreeUrl` normalizes path segments without turning encoded slashes into hierarchy. Tree rendering has stable URL keys and virtualization.
- `apps/desktop/src/main.tsx:loadSearch` currently resets the browser, selection, and scroll on every reload. Background index changes must use a separate reconciliation path.
- `apps/sidecar/src/main.ts` supports concurrent reads, serialized mutations, and background download workers. A long indexing operation must not occupy its mutation queue or block completion-notification polling.
- `packages/core/src/download/tasks.ts` demonstrates interprocess locking. Preview cache files demonstrate individually replaceable records. Reuse these patterns and existing dependencies.
- `test/search-revalidation.test.mjs` requires cache revalidation to refresh only `listado.html`, preserving directory listings, previews, and download data.

No `docs/solutions/` knowledge base or matching requirements document exists. Repository patterns are sufficient for this plan; no new search service, database dependency, or framework is proposed. No builds, runtime probes, or tests were run during planning.

## Boundaries

- Index names, URLs, parent relationships, listing sizes, and freshness metadata. Do not download media, preview payloads, or file contents to index them.
- No full-text search inside text files, fuzzy/semantic search, cloud service, shared hosted crawler, or background daemon surviving desktop quit.
- Download ignore rules do not hide search results. Index metadata must never become proof of download integrity, completion, or exact file size.
- Keep the current empty-search library presentation and folder expansion behavior. Do not serialize or render the entire file catalog merely to show collapsed roots.
- Preserve the existing `--no-cache` and Settings **Revalidate cache** behavior. A folder-index refresh is a separate explicit action; revalidating `listado.html` can enqueue newly discovered folders but is not a synchronous full crawl.

## Design Decisions

### Shared, Incremental Catalog

Use a versioned file-index cache under `~/.visuales-cli-cache/file-index/`, registered in the existing cache registry. Store one validated direct-child snapshot per canonical directory URL, with a hashed filename, plus a small durable scan checkpoint. This avoids rewriting the whole library for each fetched folder. Keep the representation plain JSON, using existing atomic replacement and locking patterns.

Each snapshot records its schema/parser version, canonical parent URL, direct-child files/subfolders, successful fetch time, and optional HTTP validators. A separate scan checkpoint records the frontier, run identity, index generation, processed/error counts, pause choice, and next retry times. Directory records are authoritative only for their own children, not entire descendant trees.

Import valid legacy discovery entries before network indexing so known matches work immediately. Legacy entries have **unknown freshness**; do not invent fetch times or count an import as a successful current scan. Re-import only changed legacy data, with validation and revision checks, not on every query. Fresh file-index records take precedence over undated legacy snapshots, including successful empty snapshots, so old data cannot resurrect removed files.

Successful browsing and download discovery publish updated directory snapshots through the same core store. Factor a reusable listing fetch/parser boundary out of the downloader/library code so the background indexer can publish directly to the file catalog without rewriting the legacy monolithic discovery cache for every scanned folder. This is a bounded extraction, not a download-engine redesign.

For existing discovery-cache writers, merge only dirty directory/file updates under a lock; do not union stale snapshots back into a refreshed listing. File-size corrections must not restore removed entries or change listing freshness. Reads remain available while network work is running. Locks cover commits, never network requests.

Use a single interprocess scan owner with heartbeat/stale-owner recovery. Include generation checks so cache clearing or replacing a run fences out late writes from an old scan. Successful snapshots are individually durable; a crash can repeat the last folder, not restart the entire scan. Cache-registry updates involved in this feature also need locked read-modify-write semantics.

### Matching and Tree Integration

Merge folder-index entries and cached file records by validated canonical URL. Match case-insensitively against decoded names and paths; normalize common filename separators such as dots, underscores, and hyphens for matching only. Preserve all-terms semantics and support both `stuart fails` and a quoted phrase against dotted filenames. Do not change original names or URLs.

Treat filename matches as primary and path matches as fallback context, preserving existing path searches. Preserve directory-first, natural tree presentation instead of imposing an unrelated flat relevance ranking. Distinct files with identical basenames in different folders remain distinct.

Apply a scoped window's canonical directory boundary before matching. Descendant file matches are allowed; similarly named sibling branches are not. Use existing stable aliases for exposed results and tree ancestors. Avoid regenerating/writing aliases for every indexed file on every query. The CLI needs structural folder context, not a duplicate copy of every unmatched file.

Cache parsed/search-normalized records in memory by index revision. Long-lived consumers detect committed changes and invalidation from other processes; queries must not repeatedly parse every directory record. A warm search performs no directory requests. Existing first-use loading of `listado.html` remains separate from file crawling.

Empty search retains lightweight folder-index data, with cached file children loaded when their parent is expanded. Where a complete file-index directory snapshot exists, browsing can use it directly. Nonempty searches return file matches with enough ancestor context for the existing tree.

### Automatic Scan and Refresh

Desktop starts one nonblocking core coordinator after the sidecar is ready, independently of which page/window is visible. Seed a FIFO queue from directory URLs in parsed `listado.html` order, deduplicating by canonical URL while preserving first occurrence. Append missing ancestors and `/`, then append newly discovered direct-child subfolders as listings are processed. Skip already-fresh snapshots in place and resume the persisted queue across launches; do not add folder-specific priority lanes or special cases for Recientes. A scoped window still searches only its branch; it does not launch a second global crawler.

Proposed conservative defaults:

- One background listing request in flight, with at least one second between requests. Foreground browsing takes the next slot ahead of background work.
- Continue indexing alongside shared downloads. Only foreground browsing defers the next background request; show **Waiting for folder browsing** while it is active. Keep the single-request limit and pacing without modifying active downloads.
- Apply one refresh policy to every directory: successful snapshots become eligible after seven days. Refresh `listado.html` for scan discovery at most once per day, retaining its last good copy on failure.
- Persist progress and a user pause choice. Normal quit aborts indexing requests and checkpoints work without changing quit/download semantics. Reopening resumes unfinished work unless the user explicitly paused it.
- Use bounded request duration/response size and cancellation, reusing the library's current 120-second/8-MB listing limits. Validate origin, protocol, redirects, direct-child containment, response shape, and canonical visited URLs before scheduling or publishing data.
- Back off on network errors and server throttling; honor a supplied retry delay. After repeated connection/server failures, enter an offline/backoff state instead of attempting every remaining folder. Keep last-known entries searchable.

Check server crawl policy before the automatic traversal and respect published restrictions. Do not follow arbitrary external links, parent links, query-sort links, or redirects outside the supported resource. If policy prevents coverage, show the skipped/inaccessible count rather than claiming the whole library is indexed.

A successful listing replaces that directory's children, removing vanished files. A valid parent snapshot that proves a subfolder absent can invalidate its indexed subtree and pending jobs, fenced against late responses. Timeout, malformed HTML, access denial, and transient failures are not empty listings. An isolated unavailable/404 result is recorded as unavailable rather than silently purging a whole cached branch.

The total folder count can grow during traversal. Report processed/known folders and failed/skipped counts, not a fabricated file percentage or ETA. A pass is current only when its frontier is exhausted without unresolved failures; it is a point-in-time observation, not proof the server cannot have newer files.

### Visible Status

**Search:** Put a compact status at the right of the existing results row, for example `Indexing files - 397 / 29,955 folders`. Keep it visible even with zero results. Use the established spinner/icon vocabulary; no new banner or permanent extra row. At narrow widths, wrap predictably. It opens the Search section of Settings as an explicit status/details button.

**Settings > Search:** Keep folder-index revalidation, and add file-index count, current pass progress, last successful refresh, and failure count. Provide Pause/Resume and Refresh file index controls using existing shadcn components. A manual refresh schedules work; it does not clear the usable catalog. While paused, a refresh requires an explicit resume. Report errors inline with a retry action, not a stream of desktop notifications.

**Search refreshes:** Publish revision changes in bounded batches, not once per file. Rerun the last submitted query against the new revision without resetting expansion, selection, keyboard focus, or the visible scroll anchor. If new results would shift an actively used list, defer their application behind a compact **New results** action. Remove disappeared selected URLs rather than retaining invisible download targets. Late responses cannot overwrite a newer query or a newly cleared search.

**CLI:** `visuales search` returns current local results and a compact coverage note when file indexing is incomplete. Proposed management surface: `visuales index` to start/resume in the foreground, plus `index status`, `index pause`, `index resume`, and `index refresh`. All controls use the same durable state and core coordinator as desktop. If another process owns the scan, attach/observe or request a state change instead of starting a duplicate. Ctrl-C detaches an observer; it pauses/checkpoints a scan owned by that CLI process. No hidden detached process from ordinary search.

## Implementation Units

- [x] **1. Durable directory catalog and safe cache publication**

**Requirements:** R1, R4, R5. **Dependencies:** None.

**Files:** Create `packages/core/src/search-file-index.ts`; modify `packages/core/src/lib/cache.ts`, `packages/core/src/lib/types.ts`, `packages/core/src/download/discovery-cache.ts`; add `test/search-file-index.test.mjs`.

**Approach:** Implement versioned per-directory storage, validation, legacy import, revisions, interprocess commits, and generation-aware clearing. Reuse locking from `packages/core/src/download/tasks.ts` and atomic record replacement from `packages/core/src/library.ts`. Characterize legacy cache behavior before changing writers.

**Verify:** Two processes update different folders without loss; a delayed older snapshot cannot replace newer data; a valid empty listing removes prior files; corrupt records do not destroy healthy records; legacy import cannot resurrect deleted entries; a clear fences late writes. Size corrections never imply completion or freshness. No download/previews/settings data is cleared by new file-index controls.

- [x] **2. File-aware shared search**

**Requirements:** R1, R4. **Dependencies:** Unit 1.

**Files:** Modify `packages/core/src/search.ts`, `packages/core/src/index.ts`, `packages/core/src/search-tree.ts` only where needed, and alias handling in `packages/core/src/lib/cache.ts`; add `test/search-files.test.mjs`; extend `test/search-scope.test.mjs`, `test/search-tree.test.mjs`, `test/search-parser.test.mjs`, `test/search-revalidation.test.mjs`.

**Approach:** Merge known folder/file sources, canonicalize and match decoded/normalized names in core, preserve aliases and structural tree context, and make queries revision-aware. Explicitly update the old scope test that expects global search to ignore discovered files; retain its branch-containment and alias assertions.

**Verify:** The supplied Stuart Fails filename matches with no network request when cached; quoted and multiargument searches agree; punctuation, percent-encoded brackets/spaces, accents, encoded slashes, duplicate URL spellings, and repeated basenames work; scoped searches cannot leak siblings. Empty search does not return the entire file catalog. A damaged/missing file catalog still permits folder search. Index revalidation remains list-only.

- [x] **3. Resumable, low-priority full-library indexer**

**Requirements:** R2, R3, R5. **Dependencies:** Unit 1.

**Files:** Create `packages/core/src/search-indexer.ts` and `packages/core/src/library-listing.ts`; modify `packages/core/src/library.ts`, `packages/core/src/download/downloader.ts`, `packages/core/src/download/discovery-cache.ts`; add `test/search-indexer.test.mjs`; extend `test/library.test.mjs` and relevant discovery/download regression tests.

**Approach:** Extract the existing listing parser/fetch boundary without changing download verification. Implement the leased coordinator, persisted FIFO frontier in parsed listado order, publication hooks, foreground-browsing precedence, paced indexing alongside downloads, uniform directory refresh policy, backoff, cancellation, and bounded status snapshots. Downloads do not block the scan.

**Verify:** A cold scan follows parsed listado order, does not move Recientes ahead of earlier entries, and eventually finds files outside listado's named branches through appended discoveries; duplicate URLs are visited once; all directories use the same refresh policy. Successful folders survive restart without refetching; explicit pause survives relaunch; late writes after clear are rejected; only one CLI/desktop scanner owns the lease; interactive browsing is not stuck behind the frontier. Test cyclic/escaped/external links, malformed/blocked HTML, valid empty listings, removals, server failure, and cancellation during a slow response using fixtures, not a real server-wide crawl.

- [x] **4. CLI lifecycle and controls**

**Requirements:** R1, R3, R4, R5. **Dependencies:** Units 2 and 3.

**Files:** Create `apps/cli/src/commands/index/index.ts`; modify `apps/cli/src/cli.ts`, `apps/cli/src/commands/search/index.ts`, and cache management integration where needed; add `test/search-index-cli.test.mjs`.

**Approach:** Expose foreground indexing, shared status/control operations, incomplete-coverage reporting, and stable result aliases. Keep ordinary search a short-lived command. Do not conflate starting/resuming indexing with refreshing every successfully indexed folder.

**Verify:** Cached search exits without spawning a worker; indexing cancellation preserves progress; a CLI observer does not cancel desktop-owned work on exit; an explicit pause does affect the shared scan; invalid options fail clearly; download-by-result-ID works for standalone files. Core and CLI counts/coverage agree.

- [x] **5. Sidecar and native indexing lifecycle**

**Requirements:** R2, R3, R5. **Dependencies:** Units 2 and 3.

**Files:** Modify `apps/sidecar/src/main.ts`, `apps/desktop/src-tauri/src/sidecar.rs`, and `apps/desktop/src-tauri/src/lib.rs`; extend `test/sidecar.test.mjs` and native bridge tests in the affected Rust modules.

**Approach:** Start the coordinator once per sidecar session, add bounded status/start/pause/resume/refresh transport operations, and forward throttled index-revision notifications. Starts return promptly with status, not after the crawl completes. Poll/reconcile shared disk revisions so CLI-owned work is visible too. Keep parsing, policy, locking, scheduling, and indexing in Node core; Rust only forwards commands/events and handles lifecycle.

**Verify:** Multiple windows do not start duplicate scans; a multi-minute listing does not block tasks, interrupt-all, notifications, search, or app quit; pause from either client is reflected in both; sidecar shutdown aborts its scan without orphaning a process; process failure recovers the lease and checkpoint.

- [x] **6. Desktop status and non-disruptive result updates**

**Requirements:** R3, R4, R6. **Dependencies:** Unit 5.

**Files:** Create `apps/desktop/src/use-search-index.ts`; modify `apps/desktop/src/main.tsx`, `apps/desktop/src/search-tree.tsx`, `apps/desktop/src/search-cache-settings.tsx`, `apps/desktop/src/styles.css`; add `test/desktop-file-index.smoke.mjs`; extend `test/desktop-search-revalidation.smoke.mjs`, `test/desktop-search-cache.smoke.mjs`, `test/desktop-library-windows.smoke.mjs`, and `test/desktop-tree-expansion.smoke.mjs`. Update `README.md`, `docs/desktop-roadmap.md`, and the origin backlog after implementation.

**Approach:** Subscribe through one reusable hook, show compact status in Search even when empty, expose Settings controls, and separate user-submitted search resets from index-refresh reconciliation. Keep existing virtualization and canonical row identity. UI mocks should explicitly cover every status rather than touching the user's actual cache.

**Verify:** Searching before indexing finishes shows available matches; new matches appear or can be applied without losing position/selection; stale responses cannot replace a newer query. Status remains visible with zero matches, paused/offline/error states, and scoped windows. Test zero-result to first-result transition, removals, expanded deep branches, and narrow/large windows in both themes. Existing row download/queue, preview, context-menu, and multiselection behavior remains intact.

## Release Gates and Execution-Time Questions

- Validate the final plan's concurrency and cache-clearing semantics with fixture-based multiprocess tests before enabling automatic network traversal. No full live crawl is needed for CI or initial correctness verification.
- Measure cold-load and warm-query time, memory, IPC payload size, and tree reconciliation on generated catalogs substantially larger than the current 12,049-file cache. Target sub-100-ms warm core searches at 100,000 files on the development machine, measured rather than assumed; avoid repeatedly scanning filesystem records for each query. Keep UI input, scrolling, transfer controls, and notification polling responsive while indexing.
- Confirm actual server listing validators and crawl policy during implementation before enabling those optimizations/requests. Conditional requests are optional when unsupported; cache correctness must not rely on them.
- The proposed one-request limit, refresh ages, and foreground-browsing-aware pacing are conservative starting policies. Tune from measurements, not by exposing many new settings in the first version.
- For very large catalogs, implementation measurements may justify partitioned in-memory loading or a different store. Do not add a database preemptively; revisit this plan explicitly if the measured constraints require it.
- Run normal core/CLI/sidecar tests, desktop browser checks, lint/build, and native tests during implementation. Verify cold import, partial scan, pause, restart, refresh failure, and cross-process use before release.
- Rollback/disable affects only automatic indexing and its disposable cache. Existing folder search, transfers, settings, and previews remain usable. Do not modify existing download records to migrate this feature.

## Execution Log

- 2026-09-17: User approved implementation, including Settings controls and source-order indexing without folder-specific priority. Working on `codex/standalone-file-index`; no release requested.
- 2026-09-17: Implemented all six units. Added the small MIT-licensed `robots-parser` dependency instead of hand-rolling crawl-policy parsing. The server's robots.txt returned 404 during the policy check; runtime still checks/caches and honors future restrictions. No server-wide live crawl was performed.
- Verification: 226 core/CLI/sidecar tests, 14 Rust tests, full Chrome desktop smoke suite, additional indexing controls/zero-result/selection-removal/deep-scroll/light-dark/narrow-layout checks, lint and builds. Additional packaged-sidecar test confirms automatic ownership while paused and lease release on shutdown.
- Performance fixture: 100,000 files, cold search roughly 513-653 ms, warm searches 24-56 ms, heap 143-150 MiB, empty-library payload 36,826 bytes for 100 folders. Unchanged directory records retain their normalized search representation. Global empty-search refreshes use the listado revision, not every file-catalog commit.
- Acceptance example: isolated copy of the actual discovery/list caches finds `Stuart.Fails.to.Save.the.Universe.S01E01.720p.HEVC.x265-MeGusta[EZTVx.to].mkv` with networking disabled. Original caches and downloads were untouched by verification.
- 2026-09-18: Investigated slow indexing and repeated failures. Read-only probes found `/MegaLibros/` returning 404 (27.4 seconds) and absent from the live root listing (6.1 seconds), while the cached listado still named 412 folders in that branch. Fixed folder-local 403/404/410 handling so it does not trigger global exponential backoff; 404/410 descendants are deferred in batches without deleting cached files and can be restored when the parent recovers. Legacy checkpoints shed the erroneous global delay and redundant child failures. Request pacing now measures start-to-start, retaining one background request and the crawl-delay limit. Partial passes can refresh seeds the next day even with missing folders. An isolated copy of the live 29,975-folder checkpoint advanced from cursor 5,012 to 5,390 in 49 ms, reducing 48 errors to 15 independent failures plus 411 skipped descendants, with zero network requests or live-cache writes. No release in this pass.
- Remaining release verification: full live crawl and native Windows/Linux UI behavior were not exercised here. No commit, push, version bump, or release performed.
- 2026-09-17: User verified indexed Biohackers episode search and authorized release 3.8.0. Final scope includes indexing alongside downloads, reliable tray-popup toggling, and decoded URI display labels. Verification expanded to 236 core/CLI/sidecar tests, 18 Rust tests, native macOS tray checks, and the full desktop browser suite. Platform-native keyboard context-menu behavior remains exercised on Linux CI; macOS browser fixtures dispatch the equivalent event.
- 2026-09-18: User authorized shipping the missing-branch and pacing fixes as 3.8.2. Deferred dev icons, date sorting, live file concurrency, and notification actions remain outside this release.
