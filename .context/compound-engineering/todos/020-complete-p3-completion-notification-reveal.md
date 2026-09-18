---
status: complete
priority: p3
issue_id: "020"
tags: [desktop, notifications, platform]
dependencies: []
---

# Reveal Downloads from Completion Notifications

## Problem Statement

Completion notifications should offer a direct action to reveal the completed download in the operating system's file manager.

## Findings

- User requested a "Show in Finder" action with wording appropriate to each OS.
- macOS needs a native UserNotifications delegate; the existing notify-rust version exposes actions only on Linux. The already-locked Windows toast backend exposes action callbacks. Keep the declared Rust baseline and use thin platform adapters.

## Proposed Solutions

Add a completion-notification action that uses the existing native reveal/open-folder behavior for the completed transfer's local destination. Use "Show in Finder" on macOS, "Show in File Explorer" on Windows, and "Open containing folder" on Linux, subject to platform verification.

## Recommended Action

Use native UserNotifications actions through objc2 on macOS, the already-locked Windows toast backend, and notify-rust actions on Linux. Snapshot the completed task's output directory into the private event, keep destination data out of OS notification payloads, and resolve actions through bounded session-only records. Banner activation uses the same destination on supporting platforms. Bare macOS dev executables retain the legacy notification-only fallback; verify real actions in a signed app bundle. Keep eligibility and preferences unchanged.

## Implementation

- [x] Snapshot each completion's destination and test independent notifications.
- [x] Add bounded, single-use native action routing and graceful missing-folder handling.
- [x] Implement macOS, Windows, and Linux native actions without changing CLI or transfer lifetime.
- [x] Verify native tests, packaged sidecar tests, permission/focus behavior, and macOS bundled delivery.
- [x] Document platform limits and update the bucket. No release requested.

## Acceptance Criteria

- [x] Completion notifications offer a reveal/open-folder action where supported.
- [x] Action wording matches the operating system.
- [x] Activating the action opens the correct local destination for the completed transfer, rather than the currently selected task or another download.
- [x] Missing or moved destinations are handled gracefully.
- [x] Existing notification preferences and completion eligibility remain unchanged.
- [x] Verify locally available platforms and document fallback behavior; Windows/Linux runtime QA is an explicit release check.

## Work Log

- 2026-09-17: Added to the bucket at the user's request. No implementation or release requested.
- 2026-09-18: User approved implementation and interruption of the dev Lost transfer for native rebuilds. Production must remain untouched. The in-progress live file-concurrency changes remain in this working tree.
- 2026-09-18: Implemented destination snapshots and native platform actions. Native suite: 26 passing tests, including actual macOS category/content, routing, expiry, and missing directories. User confirmed the signed, isolated preview's Show in Finder action opened Downloads; logs confirm activation. Bare macOS binaries retain notification-only fallback. Windows/Linux runtime checks and production-bundle activation are documented pre-release checks. No push or release requested.
- 2026-09-18: Final `npm run check` passed all 281 Node/CLI/sidecar tests, including destination snapshots across a default-folder change and a later completed transfer. Sandbox-blocked local-server tests were rerun with the required access. Native workspace tests and examples compile successfully.
