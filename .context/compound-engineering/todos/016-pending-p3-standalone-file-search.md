---
status: pending
priority: p3
issue_id: "016"
tags: [core, cli, desktop, search, cache]
dependencies: []
---

## Problem Statement

Global searches miss standalone files, such as the Stuart Fails episode in Recientes, even when directory browsing has already cached those files.

## Findings

- Global search reads listado.html; the inspected cached index contains 29,955 folders and no files.
- The exact Stuart.Fails.to.Save.the.Universe episode is already present in the shared directory discovery cache, which global search does not consult.
- Folder-scoped search includes the root's immediate children, but global search does not.

## Proposed Solutions

1. Merge indexed folders with known files from the discovery cache, deduplicated by canonical URL.
2. Refresh mixed-content folders such as Recientes in the background so their files are searchable without browsing first.
3. Consider explicit deeper indexing for unvisited folders; avoid crawling the entire server on every query.

Keep tree results, filename-first relevance, and branch-scoped search. Implement matching/indexing in shared core for CLI and desktop parity.

## Recommended Action

Deferred at the user's request. Triage the discovery scope, freshness policy, and optional deep-search behavior before implementation. Implement the separate Settings index-revalidation button first.

## Acceptance Criteria

- [ ] A search for `stuart fails` finds the matching standalone episode in Recientes.
- [ ] Cached file results appear without waiting for a server-wide scan.
- [ ] Canonical URL deduplication and branch boundaries are preserved.
- [ ] Recientes refresh behavior and coverage limitations are explicit.
- [ ] CLI and desktop use the same shared search behavior.

## Work Log

- 2026-09-17: Inspected shared search and discovery caches. User requested adding standalone-file search to the bucket, with Settings index revalidation implemented first. No standalone-file indexing changes made.
