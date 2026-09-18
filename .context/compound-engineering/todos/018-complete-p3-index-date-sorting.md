---
status: complete
priority: p3
issue_id: "018"
tags: [core, search, indexing, research]
dependencies: []
---

# Search and Library Date Sorting

## Problem Statement

The user wants index sorting that takes advantage of Apache directory listings ordered by date.

## Findings

- Verified live Apache date sorting in both directions using `?C=M;O=D` and `?C=M;O=A`: the same 20 root entries sort monotonically by displayed modification date.
- Directory listings expose dates for both files and folders; the parser now retains them. The inspected cached listado snapshot contains no per-entry timestamps.
- Dates mean server-local last modified, not upload date or newest descendant change. Cache fetch times must not be substituted.
- Existing automatic indexing follows parsed listado order, without folder-specific prioritization; local result sorting does not require changing it.
- See [research and implementation notes](../../../docs/research/2026-09-18-index-date-sorting.md) for evidence, cache rollout, code impact, and test coverage.

## Proposed Solutions

Prefer persisting optional modification dates during ordinary indexing/browsing and sorting cached results locally. Server-ordered requests alone cannot sort a combined search tree and would make sort changes depend on a slow network request. Keep folders first, unknown dates last within each group, and natural-name/URL tie breakers. Preserve existing index traversal and cache contents.

## Recommended Action

Implemented locally after the user confirmed Search/library results only. The remembered sort menu offers both name and modification-date directions in main and folder-rooted windows. CLI defaults, indexing traversal, and downloads are unchanged. Not released.

## Acceptance Criteria

- [x] Verify date-sorted listing behavior against the actual Visuales Apache server.
- [x] Establish whether usable dates are available in listado.html, directory listings, or both (cached listado snapshot inspected).
- [x] Document date semantics, limitations, and interaction with cached/indexed data.
- [x] Propose an approach and confirm sorting scope before changing indexing or UI behavior.
- [x] Retain optional dates through discovery, file indexing, and search without invalidating older caches or size-verification trust.
- [x] Sort siblings locally with folders first, unknown dates last, stable ties, and unchanged indexing traversal.
- [x] Remember the choice and preserve tree selection/expansion in Search and folder windows.
- [x] Backfill legacy undated cache entries for visible groups, with loading/retry states and no recursive date crawl.
- [x] Display known server-local modified dates on rows, with an unknown placeholder and compact narrow-window layout.
- [x] Pass core/CLI/sidecar checks and desktop UI regression tests, including narrow and light/dark layouts.

## Work Log

- 2026-09-17: Added to the bucket as a research-first item at the user's request. No research, implementation, or release performed in this pass.
- 2026-09-18: Verified live root sorting in both directions and audited the parser, shared index, search tree, CLI, and desktop merge paths. Recorded a local-metadata sorting proposal; scope confirmation remains open. Application cache and active downloads were not modified.
- 2026-09-18: User confirmed visible Search/library results only. Implemented optional date metadata, freshness-aware merging, shared sibling sorting, and a persisted desktop control. All 268 core/CLI/sidecar tests and the full desktop UI suite passed. Verified the parser against the saved live response (all 20 dates retained). Existing caches gain dates on ordinary refresh; no cache wipe, extra crawl, or release.
- 2026-09-18: Fixed the legacy-cache rollout after the user reported alphabetical ordering in Peliculas/Extranjeras/2026. Missing dates now load for visible sibling groups, without changing search membership or crawling collapsed branches. Verified 110/110 live dates and distinct newest/oldest results. All 270 core/CLI/sidecar tests, 19 native tests, and the full desktop UI suite passed; dev refreshed, production workers left running, no release.
- 2026-09-18: Added a muted right-aligned date/time to Search and folder-window rows at the user's request. Known dates persist across sort modes, unknowns show `--`, and narrow windows omit the time. No new network requests or core changes for this display addition. Desktop build, lint, and full UI suite passed, including date alignment, exact server-local labels, asynchronous updates, and unchanged 44px row heights. Verified screenshots in light/dark and narrow layouts; live in dev through HMR.
- 2026-09-18: Simplified listing rows to date-only labels at every width and removed inline refresh controls, retaining folder refresh in the context menu. Tightened the action column around queue/download without shrinking their hit areas. Desktop build, lint, formatting, and the full UI suite passed, including context-menu refresh, loading states, scroll preservation, and responsive date alignment. Live in dev; not released.
