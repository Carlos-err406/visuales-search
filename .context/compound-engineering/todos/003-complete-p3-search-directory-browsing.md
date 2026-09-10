---
status: complete
priority: p3
issue_id: "003"
tags: [desktop, search, later]
dependencies: ["009"]
---

# 2.2: List Directory Contents in Search

## Problem Statement

The user wants to inspect the files inside search-result directories before selecting downloads.

## Findings

- Search currently selects directory results as complete download targets.
- The shared Node core already discovers directory contents for downloads.
- Requested for the Later bucket, not implementation in the current UI cleanup.
- On 2026-09-10, tree presentation was split into 2.1 (009). This item covers loading actual folder contents into that tree, including files not present in the original search results.

## Proposed Solutions

Use the shared Node discovery mechanics through the sidecar to list folder contents on demand in the Search tree. Reuse the shared directory cache; do not implement a second discovery engine in Rust or the UI.

## Recommended Action

Approved on 2026-09-10, following tree layout (009). Expansion loads unopened directories on demand. Matching ancestors start expanded to show search hits; collapsing and reopening loads their full contents. Only loaded folders show refresh controls. Merge children by URL, preserve search and selection, and reuse the shared core/cache.

## Acceptance Criteria

- [x] Inspect files within a directory from Search without starting a download.
- [x] Collapse/expand without losing the search query, results, or selection.
- [x] Select individual files and directories with clear selection behavior.
- [x] Handle slow, missing, and empty listings with loading/error/empty states.
- [x] Load actual folder contents on demand into the tree, including non-matching children, without duplicating existing results.
- [x] Reuse shared Node discovery and cache behavior; collapsing and reopening does not unnecessarily fetch the same listing again.

## Work Log

### 2026-09-08 - Requested for Later

Recorded the user's request alongside menu bar progress. No directory-browsing implementation authorized in this pass.

### 2026-09-10 - Narrowed to Folder Listings

Renamed to bucket item 2.2. Finder-style hierarchy and disclosure belong to 2.1 (009); this item adds actual directory contents. Remains deferred.

### 2026-09-10 - Implemented Locally

Exposed library.list through the Node sidecar and a thin Tauri command. Reuses the core directory parser and discovery cache, handles empty listings, offers refresh/retry, validates same-library immediate children, and ignores responses from replaced searches. Core HTTP fixture tests, packaged-sidecar RPC tests, native tests, and UI smoke checks pass. No managed downloads are started by browsing. Not released.
