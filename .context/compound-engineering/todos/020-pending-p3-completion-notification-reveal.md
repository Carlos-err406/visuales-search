---
status: pending
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
- Scope is desktop completion notifications; notification action support and activation behavior on each platform still need investigation.

## Proposed Solutions

Add a completion-notification action that uses the existing native reveal/open-folder behavior for the completed transfer's local destination. Use "Show in Finder" on macOS, "Show in File Explorer" on Windows, and "Open containing folder" on Linux, subject to platform verification.

## Recommended Action

Pending triage. Verify notification action support and how activation resolves the correct transfer destination before implementation. Define a fallback where explicit notification buttons are unavailable.

## Acceptance Criteria

- [ ] Completion notifications offer a reveal/open-folder action where supported.
- [ ] Action wording matches the operating system.
- [ ] Activating the action opens the correct local destination for the completed transfer, rather than the currently selected task or another download.
- [ ] Missing or moved destinations are handled gracefully.
- [ ] Existing notification preferences and completion eligibility remain unchanged.
- [ ] Verify supported platforms and document any fallback for unavailable notification actions.

## Work Log

- 2026-09-17: Added to the bucket at the user's request. No implementation or release requested.
