---
status: complete
priority: p3
issue_id: "004"
tags: [desktop, search, images, text, cache, later]
dependencies: []
---

# 2.3: Cached Image and Text Previews

## Problem Statement

The user wants to click an image or text file in Search or a browsed directory and preview it inside the app. Preview content must be cached for reuse.

## Findings

- Search currently offers selection/download only.
- Related to directory browsing (003), but direct image search results can also be previewed.
- Requested for the Later bucket, not immediate implementation.
- On 2026-09-10, the former image-preview bucket item 3 became 2.3, expanded to include text files and mandatory preview caching.

## Proposed Solutions

Add an on-demand image/text viewer that leaves search and selection state intact. Use the shared Node transport and unified cache for preview data, separate from managed downloads. Cache reuse is required; supported formats, byte limits, retention, and invalidation remain implementation decisions to triage. Treat text as inert content, never executable HTML or scripts.

## Recommended Action

Approved on 2026-09-10. Click supported file names to preview; checkboxes select downloads. Use the existing Base UI dialog primitive for modal focus/close behavior. Fetch only on demand. Cache previews on disk under the unified cache for 24 hours, bounded to 32 MB, with explicit refresh and CLI clear/inspect support. Limit images to 4 MB (PNG/JPEG/GIF/WebP) and UTF-8 text to 512 KB. Reject active image formats, binary text, external URLs, and redirects to other resources.

## Acceptance Criteria

- [x] Clicking a supported image or text file opens an in-app preview without starting a managed download.
- [x] Closing returns to the same search or directory position and selection.
- [x] Loading, unavailable content, unsupported image data, binary/non-text content, and oversized files have explicit errors; unsupported extensions have no preview action.
- [x] Keyboard opening/closing and focus restoration work.
- [x] Reopening cached image or text content reuses the preview cache for 24 hours unless explicitly refreshed.
- [x] Preview data uses the unified cache with 32 MB eviction, expiry, explicit refresh, and CLI clear/inspect support.
- [x] Text renders safely without executing remote markup or scripts.

## Work Log

### 2026-09-08 - Requested for Later

Recorded image previews as a separate deferred feature related to directory browsing. No preview code added.

### 2026-09-10 - Expanded to Cached Image and Text Previews

Moved the former bucket item 3 under Search as 2.3. Added text previews and required caching for both content types. Direct file search results can be previewed independently of directory browsing; browsed files should use the same viewer and cache.

### 2026-09-10 - Implemented Locally

Added bounded, on-demand previews in the shared Node core and a Base UI dialog in desktop. Raster image and inert UTF-8 text previews use a persisted, registered cache with atomic writes, refresh, expiry, and oldest-first eviction. External targets/redirects, binary text, and oversized streams are rejected. Core and packaged RPC tests verify cache behavior; browser tests verify inert text, image decoding, selection isolation, focus restoration, and both themes. Browser tests mock native IPC; HTTP fixture tests exercise real streaming and parsing without contacting the production library. Not released.
