# Date-Based Index Sorting

Date: 2026-09-18

Status: Researched, implemented locally, and regression-tested for visible Search/library results. Not released.

## Chosen Behavior

Persist each entry's Apache modification date during ordinary browsing/indexing, then sort Search/library siblings locally. Keep the existing parsed-listado indexing order. When date sorting encounters legacy undated entries, it backfills one visible sibling group's parent listing at a time. The comparator itself performs no I/O; changing directions reuses captured metadata. No index reset or separate library-wide scan is required.

Search menu: Name A-Z (current default), Name Z-A, Modified newest first, Modified oldest first. Preserve folders-first grouping, sort within each directory, remember the choice, and place undated items last within their file/folder group. Resolve date ties by natural name and canonical URL. The user confirmed visible-result sorting only; the CLI's command options/default ordering and the background traversal remain unchanged. No new Settings section is added.

At the user's follow-up request, rows display a compact right-aligned modification date beside sizes/actions: `YYYY-MM-DD` at every window width. Unknown dates show `--`. Date labels use the server-local calendar date without a client-timezone conversion or native row tooltip; sorting still uses the full timestamp. Dates remain visible with name sorting, and this display alone does not initiate additional fetches. Inline refresh controls are removed; folder refresh remains available in the context menu.

## Live Verification

Read-only probes against Visuales on September 18, 2026:

| Request                                           | Result                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Root listing](https://visuales.uclv.cu/)         | HTTP 200; 20 entries: 15 folders and 5 files. Name ordering, with a modification date on every entry.    |
| [Newest first](https://visuales.uclv.cu/?C=M;O=D) | HTTP 200; identical entry set, monotonically descending displayed dates.                                 |
| [Oldest first](https://visuales.uclv.cu/?C=M;O=A) | HTTP 200; identical entry set, monotonically ascending displayed dates.                                  |
| [robots.txt](https://visuales.uclv.cu/robots.txt) | HTTP 404. No published robots file at the time of this probe; existing crawler policy remains unchanged. |

Newest-first began with `Recientes/` (`2026-09-18 11:06`) and ended with `ProgramacionCompetitiva/` (`2023-03-01 03:58`); oldest-first reversed those endpoints. Both file and directory rows participated in the order. The root does not currently group all folders before files; retaining folders-first in Visuales would be an intentional UI convention.

The response identifies `Apache/2.4.57 (Debian)`. Default and oldest-first root requests took 54.6 and 76.0 seconds respectively for 4,646-byte bodies. These are observations from this connection, not a general benchmark. Refetching on every sort toggle would be undesirable.

The default listing already contains the same date column: changing the request order is unnecessary to collect dates. Root response headers contained neither `ETag` nor `Last-Modified`; their HTTP `Date` is not an item modification date.

The inspected local `listado.html` snapshot, cached on September 17 at 15:32:58 UTC, contains 29,970 anchors in a directory tree, no tables or timestamp attributes, and no date/time tokens. It cannot supply per-entry dates. Raw probe bodies/headers are retained locally in `.cache/date-sort-research/`, outside the application cache and Git.

A fresh listado request returned HTTP 200 but timed out at 120 seconds after receiving a partial body. That incomplete response is retained as `listado.partial.html` and was not treated as a verified full snapshot or installed into the app cache. The absence-of-dates finding above is based on the complete cached snapshot, not that partial response.

## Date Semantics

Apache documents `C=M` as last-modified sorting and `O=A` / `O=D` as ascending / descending. These remain documented in the current 2.4 manual with no deprecation notice. The options affect one directory listing, not a recursive library index. [Apache mod_autoindex documentation](https://httpd.apache.org/docs/2.4/mod/mod_autoindex.html)

Apache's 2.4.x source reads each entry's filesystem modification time and formats it in server-local time. The observed HTML exposes minutes, without seconds or a timezone. This is not an upload date, a release date, or the newest modification anywhere below a folder. Do not use a directory date to prove that its descendants are unchanged. [Apache date handling source](https://raw.githubusercontent.com/apache/httpd/2.4.x/modules/generators/mod_autoindex.c)

Representation: optional, calendar-validated `modifiedLocal` string in `YYYY-MM-DDTHH:mm` form. Compare its components/string without converting through the user's timezone or appending a fabricated UTC offset. Equal displayed minutes can conceal different underlying timestamps, so local tie ordering cannot promise byte-for-byte agreement with Apache's exact ordering. Missing, malformed, or unsupported formats remain unknown rather than becoming today's date or zero.

True "recently added" would require separate first-seen tracking and still could not recover historical upload dates. It is not part of this proposal.

## Repository Findings Before Implementation

| Area                                                                                                                 | Current behavior and required consideration                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Listing parser](../../packages/core/src/library-listing.ts)                                                         | Reads Apache table filename and size cells, discarding the date cell. The preformatted-listing path also drops dates. Parse both supported layouts without treating a date-like filename as metadata. Keep existing URL validation and parent/sort-link exclusions.                                                |
| [Discovery cache](../../packages/core/src/download/discovery-cache.ts)                                               | Stores directory URLs as strings and files with size/exactness. Add optional per-entry metadata without changing directory discovery identity. Retain it through normalization and cache merges. Do not bump the size-verification parser version merely for display dates; it also controls trust in exact sizes. |
| [Library entries](../../packages/core/src/library-types.ts) and [search types](../../packages/core/src/lib/types.ts) | The active result contracts have no modification-date field. Add shared optional metadata; the legacy `DirectoryItem.lastModified` field does not reach these paths.                                                                                                                                               |
| [File index](../../packages/core/src/search-file-index.ts)                                                           | Persists `LibraryEntry[]` per directory. Validate optional dates, accept old records, and preserve generation/freshness/removal protections. `fetchedAt` is cache age, never content age. Publish metadata changes through the existing revision mechanism.                                                        |
| [Core search](../../packages/core/src/search.ts)                                                                     | Empty global Search intentionally uses listado entries, not every indexed file. Enrich those existing entries and synthesized ancestors by canonical URL without flattening the whole file index into the empty-search view. Nonempty and folder-scoped searches need the same metadata.                           |
| [Tree sorting](../../packages/core/src/search-tree.ts)                                                               | Reorders siblings alphabetically regardless of incoming server order. Introduce the shared comparator here rather than relying on fetch order. Keep canonical identity, nesting, and selection semantics intact.                                                                                                   |
| [Desktop merge](../../apps/desktop/src/search-tree.tsx)                                                              | Merges browsed and search entries with a size fallback only. Prevent a date-less listado entry from erasing known listing metadata. Define freshness precedence rather than preserving stale dates indefinitely when a newer listing omits them.                                                                   |
| [CLI tree](../../apps/cli/src/commands/search/tree-builder.ts)                                                       | Uses a separate tree renderer. If CLI sorting is included, use the same comparator there; sorting a flat result array alone is insufficient. Preserve the current CLI default.                                                                                                                                     |
| [Indexer](../../packages/core/src/search-indexer.ts)                                                                 | Keeps parsed-listado seed order and currently considers file-index records fresh for seven days. Collect metadata on its existing requests; do not reorder the frontier or increase concurrency for this feature.                                                                                                  |

Keep all engine work in the shared TypeScript core. Tauri/sidecar should only transport the optional metadata and sort choice, not implement a second parser or crawler. Sort query parameters must not leak into canonical item URLs, download identities, or cache keys; the recommended local approach does not need to relax `libraryUrl`'s query rejection.

## Cache Rollout

- Existing records remain readable and useful; unavailable dates are not a reason to hide an item or block browsing.
- Dates fill in as listings refresh. Legacy records lack dates even when their contents are fresh; date sorting requests missing metadata for visible sibling groups without waiting for the normal seven-day expiration. A checked listing with genuinely unavailable dates is reused rather than fetched repeatedly.
- Existing Refresh file index / folder Refresh cache operations can request earlier backfill. Revalidate cache only refreshes listado and cannot fill dates. Do not silently clear caches or start a separate full-library crawl.
- A folder's own date comes from its parent listing, not its children's dates or the time we fetched its contents. Inferred ancestors without authoritative metadata remain undated.
- Name sorting and normal browsing retain their cache-only fast paths. Date mode backfills only visible groups, shows Loading dates, and offers Retry loading dates on failure. On async metadata updates, preserve selection and expanded folders by URL and anchor the viewport; avoid jumping the reader back to the top. Metadata from unmatched siblings never adds them to search results.

## Verification Before Implementation Is Complete

1. Parser fixtures for table/pre listings, files/folders, encoded names, missing dates, invalid calendar dates, and existing exact-size behavior.
2. Old/new cache round trips, discovery import, normalization, refreshes, stale writers, removed branches, and date-only revision changes. All fixtures use isolated cache homes.
3. Comparator tests for both date directions, unknowns last, same-minute ties, folders-first, natural names, nested trees, and non-UTC client environments.
4. Global empty Search, matching files, synthesized parents, and folder-scoped windows retain dates without duplicate rows or exposing unrelated indexed entries.
5. Desktop sort persistence, menu state, keyboard selection, collapse state, and scroll anchoring during indexing; already-dated sort changes make no additional requests. Legacy data backfills on demand, errors are retriable, and collapsed/offscreen branches are not crawled.
6. CLI parity tests if CLI controls are included. Existing default output and indexing traversal order must remain unchanged.

## Implementation Notes

- `DirectoryListing.modified` is an optional canonical-URL date map; directory discovery retains its existing string URL representation and size-verification version.
- `modifiedCheckedAt` records the listing observation time independently from content time. A newer observation without a date clears stale date metadata; an older or date-unaware result cannot erase a newer observation.
- The shared parser supports the observed `YYYY-MM-DD HH:mm` and Apache's legacy `DD-MMM-YYYY HH:mm` layouts. The date comparator validates dates before sorting and is independent of the client's timezone.
- Desktop persists `visuales.search-sort`, synchronizes it across windows, and applies the same control to folder-rooted windows. Invalid/unavailable storage falls back to Name A-Z without disabling sorting.
- Date-sorted empty Search follows file-index revisions as well as normal listing loads, so dates can arrive without a listado refresh. Existing staging/scroll safeguards decide whether to offer New results rather than move rows during interaction.
- Verification covers parser/cache/search behavior, the existing 100,000-file performance fixture, menu persistence, keyboard dismissal, selection/collapse preservation, folder-rooted windows, index updates, and narrow/light/dark layouts. Automated tests use isolated fixture data. A separate live check fetched missing dates for the user's reported 2026 folder into the shared cache; no downloads or other cache segments were changed.

## Legacy Cache Follow-Up

The first implementation passed dated fixtures but left old caches undated until ordinary refresh. The user reproduced unchanged alphabetical order in `Peliculas/Extranjeras/2026`. Read-only inspection found 6,160 directory records containing 104,431 entries, with zero date observations. This confirmed a rollout bug rather than a comparator failure.

`library.list` now accepts an optional `requireDates` flag through Tauri and the Node sidecar. It bypasses only date-unaware index/discovery hits for the requested directory, serializes missing-metadata fetches, and rechecks after waiting so concurrent windows reuse the first successful result. Ordinary browsing/download callers retain their previous behavior. The desktop requests one visible group at a time and merges dates into existing tree nodes, including inferred ancestors, without changing row membership or selection targets.

Live verification returned 110 entries with 110 dates for the reported folder. Newest-first starts with `The.Whisper.Man.` (`2026-09-16T10:50`); oldest-first starts with `53 domingos` (`2026-04-25T08:49`, tied with other entries). These dates were persisted through the normal shared cache path. Regression fixtures cover an undated index plus undated discovery cache, checked unknown dates, concurrent requests, inferred ancestors, loading/retry UI, and direction changes without refetching.

## Verification Results

- `npm run check`: lint, builds, and all 270 core/CLI/sidecar tests passed.
- `cargo test --workspace`: all 19 native tests passed. Existing example dead-code warnings remain. Whole-workspace formatting reports pre-existing dev-icon test formatting in `tray.rs` and `examples/tray-smoke.rs`; those unrelated files were not changed.
- `npm --prefix apps/desktop run build`: passed; existing bundle-size warning remains.
- `BROWSER_CHANNEL=chrome npm run test:desktop`: full desktop UI suite passed, including the new sorting checks and folder-rooted windows.
- The new parser retained dates for all 20 entries in the saved live root response; local date sorting produced the verified newest/oldest folder endpoints.
- Inspected desktop and narrow screenshots in light/dark themes, including the open sort menu. Screenshots are under `.cache/desktop-ui/search-date-sort*.png`.
- The development app was rebuilt and restarted with the updated sidecar for interactive testing. The installed production process and its active workers were left running.
