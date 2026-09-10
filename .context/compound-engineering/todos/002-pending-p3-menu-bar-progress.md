---
status: pending
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

Planning requested. The user approved all desktop platforms, status-only while the app runs, with no close/quit lifecycle change. Review the [implementation plan](../../../docs/plans/2026-09-10-001-feat-menu-bar-progress-plan.md) before coding. Presentation details remain proposed; implementation has not started.

## Acceptance Criteria

- [ ] Platform scope and menu bar presentation are agreed during future triage.
- [ ] Status reflects the shared engine's tasks, including tasks started from the CLI.
- [ ] Unknown totals, queued work, failures, and idle states are represented honestly.
- [ ] Users can reach the main Downloads view from the menu bar surface.
- [ ] Closing the window and quitting the app have explicitly agreed behavior.

## Work Log

### 2026-09-08 - Added to Later

Captured the user's menu bar progress request. Priority p3 indicates deferred work, not a judgment against its value. Detailed scope is intentionally unapproved.

### 2026-09-10 - Cross-Platform Plan

User selected macOS, Windows, and Linux with status-only integration. Planned native menus backed by a shared-core summary and single-flight native refresh, honest unknown/stale states, and Open Downloads navigation. No close-to-tray, background worker lifetime changes, implementation, or release authorized. Platform-specific API limitations and native verification requirements are documented in the plan.
