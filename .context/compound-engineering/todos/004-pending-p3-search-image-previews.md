---
status: pending
priority: p3
issue_id: "004"
tags: [desktop, search, images, later]
dependencies: []
---

# Preview Images in Search

## Problem Statement

The user wants to click an image in Search or a browsed directory and preview it inside the app.

## Findings

- Search currently offers selection/download only.
- Related to directory browsing (003), but direct image search results can also be previewed.
- Requested for the Later bucket, not immediate implementation.

## Proposed Solutions

An on-demand image viewer that leaves search and selection state intact. Reuse the Node transport where needed; decide supported formats, size limits, and caching when triaged.

## Recommended Action

Keep deferred. Define the distinction between selecting and opening an image, accessible close/focus behavior, and loading/error handling. Avoid fetching every image automatically.

## Acceptance Criteria

- [ ] Clicking an image opens an in-app preview without starting a managed download.
- [ ] Closing returns to the same search or directory position and selection.
- [ ] Loading, unavailable images, unsupported formats, and oversized files have explicit states.
- [ ] Keyboard opening/closing and focus restoration work.

## Work Log

### 2026-09-08 - Requested for Later

Recorded image previews as a separate deferred feature related to directory browsing. No preview code added.
