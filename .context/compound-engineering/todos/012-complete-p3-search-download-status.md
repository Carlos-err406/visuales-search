---
status: complete
priority: p3
issue_id: "012"
tags: [desktop, search, downloads, ux]
dependencies: []
---

# Download Statuses in Search

## Problem Statement

Show download statuses on folder and file rows in Search so users can see transfer state while browsing the library or search results.

## Findings

- Initially deferred; user approved implementation on 2026-09-11.
- CLI and desktop share task state; this should remain the source of truth.
- Search already supports folder expansion, cascading selection, and file previews. Status presentation should preserve those interactions and avoid adding clutter.

## Proposed Solutions

- Add compact row-level status indicators backed by shared transfer state.
- During triage, define folder aggregation and how to handle partial downloads, multiple matching tasks, and missing file-level status.

## Recommended Action

Implemented as compact right-aligned labels. Exact targets show recorded transfer state; inherited descendants show "Folder transfer ..." for non-completed states only. Ancestors do not aggregate child transfer statuses or show "Contains ..." labels. Completion is shown only on exact transfer targets. Active work takes priority, then the latest attempt. File progress requires a fresh exact URL; historical folder completion is not a local-file inventory.

## Acceptance Criteria

- [x] Folder and file rows show their known download status in search results and empty-search library browsing.
- [x] Status reflects shared CLI/desktop transfer state and updates as transfers change.
- [x] Partial or unknown folder coverage is not presented as fully downloaded.
- [x] Expansion, selection, previews, and scroll position remain unaffected.
- [x] Visual treatment and aggregation rules are agreed before implementation.

## Work Log

### 2026-09-10

- Added to the desktop roadmap as deferred bucket item 2 at the user's request.
- No application changes or release actions performed.

### 2026-09-11

- Implemented on `codex/search-status-quit-warning`; not released.
- Shared core adds a browser-safe URL status index and optional file URL progress metadata. CLI behavior/defaults remain unchanged; old task records still work.
- Respect exclusions, distinguish partial coverage, handle batch targets/multiple destinations, and hide stale labels on connection failure.
- Unit tests cover statuses and coverage rules. Playwright verifies live updates, stable row identity/selection/scroll, empty-search library labels, and non-overlapping layouts at 1240/760/390px. Existing Search/preview regressions pass.
- Follow-up: removed inherited/aggregate completion labels at the user's request; exact completed folders/files retain their status. Other transfer states remain unchanged.
- Clarification: removed all "Contains ..." labels, regardless of status. Child transfers no longer override an ancestor's own transfer label.
