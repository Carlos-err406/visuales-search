---
status: complete
priority: p2
issue_id: "001"
tags: [desktop, ui, next-pass]
dependencies: []
---

# Desktop Search Workspace

## Problem Statement

The current search screen shares its width with permanent selection and task panels. The user selected a search-first workspace direction and asked to triage its scope before another UI refactor.

## Findings

- `apps/desktop/src/main.tsx` currently renders search, selection, and tasks together.
- The desktop already uses the same task store and Node engine as the CLI.
- Existing controls cover destination selection, immediate/queued downloads, resume, cancellation, and task removal.
- Teal, JetBrains Mono, 1px corners, and less bold type are established user preferences.

## Proposed Solutions

1. Search and Downloads tabs, full-width results, contextual selection bar, and a compact expandable transfer tray. Recommended for search space and persistent activity awareness.
2. The same tabs and contextual bar with an always-expanded transfer tray. Gives transfers more prominence at the cost of search height.

Effort: medium UI refactor plus interaction and responsive-layout verification. Risk: medium around preserving selection, async task updates, and scrolling across views.

## Recommended Action

Implement the scope in [Desktop Roadmap](../../../docs/desktop-roadmap.md) in the implementation phase. The user selected the compact activity strip: show it for active or queued transfers, allow expansion into a short list, and hide it when idle while keeping failures discoverable. On Downloads, show the full table instead of duplicating the tray. Menu bar progress remains deferred.

## Acceptance Criteria

- [x] Search and Downloads have clear tabs and retain their state when switching.
- [x] Results use the full content width without a permanent selection sidebar.
- [x] Selection reveals an action bar with destination, clear, Download, and Queue controls.
- [x] Search action bar and transfer tray never overlap or obscure list content.
- [x] The tray defaults to a compact activity strip for active/queued transfers, expands on demand, and hides when idle; failed transfers remain discoverable.
- [x] Downloads shows task names, progress, available speed, status, and supported actions from the shared store.
- [x] Cancellation, interruption, and resume labels reflect actual engine behavior.
- [x] CLI-started tasks remain visible and manageable from the desktop.
- [x] Long names and paths fit at default and minimum supported window sizes.
- [x] Teal, JetBrains Mono, and 1px corners are preserved with restrained weights.
- [x] Keyboard selection, focus, loading, empty, and error states are verified.

## Work Log

### 2026-09-08 - Initial Triage

Recorded the user's selected direction and drafted a scoped UI pass. Tray default remains open. No application code changed.

### 2026-09-08 - Tray Decision

User selected option 1: compact activity strip, expandable. Recorded the decision and marked this UI scope ready for implementation. Menu bar progress remains in Later. No application code changed during triage.

### 2026-09-08 - Implementation and Verification

Replaced the permanent sidebar with Search and Downloads tabs, full-width results, a contextual destination/action bar, and a compact expandable transfer strip. Added shift/keyboard multi-selection, status/text filtering, per-task errors, connection recovery, and independent scroll retention. Transfer polling and actions still use the existing Tauri commands and shared Node task store; no core or worker behavior changed.

Bundled JetBrains Mono regular/medium/semibold with its OFL license. Retained teal and 1px corners. Short windows reduce heading/tray height to preserve result space.

Verification: `npm run check` passed all 66 tests, including shared CLI/sidecar lifecycle tests and five new presentation-helper tests. `test/desktop-ui.smoke.mjs` passed using an isolated mock bridge in Chrome: default 1240x820, minimum 760x620, and narrow 390x844 screenshots; selection and queue/download payloads; keyboard controls; search/download state and scroll retention; task actions/filters; loading, failures, reconnect, and external task-list updates. Screenshots inspected in `.cache/desktop-ui/`. Native macOS release app rebuilt successfully. Live upstream downloads were not started for UI verification; Windows/Linux native builds were not run in this pass. Menu bar progress remains deferred.

### 2026-09-08 - Search Cleanup Follow-up

Responded to user feedback about clutter: removed the redundant Search heading, server label, local-engine Connected badge, result ID/type columns, and repeated selection count. Search now has a single focus boundary, explicit clear action, and icon submit control; the empty results toolbar stays hidden. The expanded tray shows brief transfer summaries instead of duplicating the Downloads table. Downloads retains its layout.

Transfer confirmations fade and are removed after four seconds. Added open-output-folder buttons beside the destination and on download rows, using a directory-only native command and Tauri's opener. Missing folders show an error rather than being created automatically; URLs, files, and relative paths are rejected.

Verification: 66 Node tests, two Rust tests, desktop build, and updated browser checks passed. Checks cover folder command payloads/errors, confirmation lifetime, clear-search focus, and default/minimum/narrow screenshots. Native macOS app rebuilt. Actual Finder/Explorer interaction and Windows/Linux execution were not automated. Directory browsing (003) and image previews (004) are recorded as deferred, not implemented.
