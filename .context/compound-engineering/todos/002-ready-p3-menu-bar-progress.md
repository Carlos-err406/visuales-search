---
status: ready
priority: p3
issue_id: "002"
tags: [desktop, later, menu-bar]
dependencies: []
---

# Menu Bar Progress

## Problem Statement

The user wants to monitor transfers from the menu bar in a later iteration, without keeping the main desktop window in view.

## Findings

- Explicitly requested as a future feature, not part of the current UI refactor.
- Progress must come from the existing shared CLI/desktop task state.
- The desktop currently stops its owned workers when it exits. Menu bar visibility alone does not change that lifecycle.

## Proposed Solutions

1. Menu bar status while the app is running, with a compact summary and a way to open Downloads. Lowest additional lifecycle complexity.
2. A persistent tray utility that can keep desktop-owned downloads running after the window closes. Requires a separate close-versus-quit policy and worker-lifetime design.

Effort: medium for status-only integration; larger if background lifecycle changes are included. Platform-specific behavior needs investigation during future triage.

## Recommended Action

Implementation authorized: custom Mini Downloads popup on macOS/Windows with native-menu fallback on Linux. Popup includes folder and interrupt/resume controls plus status filtering; native fallback remains status-only. Shared CLI/desktop state and close/quit lifecycle are unchanged. Local implementation is present; complete Windows/Linux native verification before marking this item complete or releasing. See [verification notes](../../../docs/menu-bar-progress.md).

## Acceptance Criteria

- [x] Platform scope and popup/native fallback presentation agreed.
- [x] Status reflects the shared engine's tasks, including tasks started from the CLI.
- [x] Unknown totals, queued work, unavailable and idle states are represented honestly.
- [x] Users can reach the main Downloads view from the menu bar surface.
- [x] Closing the window and quitting the app preserve existing behavior.
- [ ] Native Windows/Linux verification completed.

## Work Log

### 2026-09-11 - Popup Controls and Filtering

User expanded the popup scope to include the existing Downloads folder and interrupt/resume actions, plus status filtering. Replaced whole-row navigation with read-only rows and explicit tooltip-equipped controls. Default Active filter includes queued transfers; historical states are selectable. Added pending/error states, stable active ordering, shared historical progress summaries, and tests for filters, actions, polling/tooltip stability, and Escape behavior. No release requested.

### 2026-09-11 - Mini Downloads Popup

User chose option 3 and authorized implementation. Added a shared-core summary, sidecar snapshot, native single-flight monitor, themed popup, native Linux fallback, and retained Downloads navigation. Native macOS smoke checks pass for popup focus/dismissal and minimized-window navigation; engine and Rust tests pass. No version bump, commit, push, or release. Keep ready until remaining platform verification is complete.

### 2026-09-08 - Added to Later

Captured the user's menu bar progress request. Priority p3 indicates deferred work, not a judgment against its value. Detailed scope is intentionally unapproved.

### 2026-09-10 - Cross-Platform Plan

User selected macOS, Windows, and Linux with status-only integration. Planned native menus backed by a shared-core summary and single-flight native refresh, honest unknown/stale states, and Open Downloads navigation. No close-to-tray, background worker lifetime changes, implementation, or release authorized. Platform-specific API limitations and native verification requirements are documented in the plan.
