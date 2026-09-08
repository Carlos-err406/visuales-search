---
status: pending
priority: p3
issue_id: "003"
tags: [desktop, search, later]
dependencies: []
---

# Browse Directories in Search

## Problem Statement

The user wants to inspect the files inside search-result directories before selecting downloads.

## Findings

- Search currently selects directory results as complete download targets.
- The shared Node core already discovers directory contents for downloads.
- Requested for the Later bucket, not implementation in the current UI cleanup.

## Proposed Solutions

Use the existing Node discovery mechanics through the sidecar to expose directory contents. Triage inline expansion versus a navigable folder view before implementation.

## Recommended Action

Keep deferred. Define navigation, selection across folders, and loading/error behavior when picked up. Preserve search state and reuse the shared core/cache.

## Acceptance Criteria

- [ ] Inspect files within a directory from Search without starting a download.
- [ ] Navigate back without losing the search query, results, or selection.
- [ ] Select individual files and directories with clear selection behavior.
- [ ] Handle slow, missing, and empty listings with loading/error/empty states.

## Work Log

### 2026-09-08 - Requested for Later

Recorded the user's request alongside menu bar progress. No directory-browsing implementation authorized in this pass.
