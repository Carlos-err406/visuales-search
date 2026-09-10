---
status: complete
priority: p3
issue_id: "010"
tags: [desktop, search, later]
dependencies: ["009", "003"]
---

# 2.4: Browse the Library When Search Is Empty

## Problem Statement

When Search has no query, show the parsed listado.html library so users can browse freely without first entering search terms.

## Findings

- Explicitly requested for the bucket, not implementation in the current fixes.
- Reuse the shared Node listado.html parser/cache and the existing Search tree.
- Initial empty Search and clearing a query should both lead to the library view.
- The complete index may be large; rendering and expansion must remain responsive.

## Proposed Solutions

Expose the parsed library index through the sidecar and render it with the Search tree. Keep filtering, directory loading, and cached file previews on the existing shared-core paths. Render large expanded branches with TanStack Virtual.

## Recommended Action

Approved and implemented on 2026-09-10. Load the shared parsed index on launch; start with collapsed top-level folders. Clearing a query restores that index and clears the previous download selection. Reuse the index in memory for the current app session, including offline, and expose Retry when initial loading fails. Keep directory requests on demand and reject stale search responses after clearing.

## Acceptance Criteria

- [x] Empty Search shows the parsed listado.html library, including after clearing a query.
- [x] Submitting search terms filters the library through the shared engine.
- [x] Directory expansion and cached image/text previews remain available.
- [x] Large indexes stay responsive without eagerly fetching every directory.
- [x] Loading, unavailable-server, and cached-data states are handled explicitly.
- [x] Query transitions clear old selections and do not start downloads.

## Work Log

### 2026-09-10 - Added to Later

Recorded the user's request for free browsing from empty Search as item 2.4. No implementation included in the tooltip and folder-control fixes.

### 2026-09-10 - Implemented Locally

The local index contains approximately 30,000 entries across 16 roots. The desktop now requests empty search terms through the existing shared parser/cache, starts collapsed, and virtualizes branches above 200 visible nodes. Clearing via the button, keyboard, or whitespace restores the cached library. Request generation guards prevent late search responses from overwriting it. Selection/keyboard navigation, offline reuse, loading failures/retry, empty indexes, and a 3,000-folder branch have regression coverage. Download target deduplication now uses ancestor lookups instead of pairwise comparisons for large selections. No release requested.
