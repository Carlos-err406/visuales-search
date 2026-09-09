---
status: pending
priority: p3
issue_id: "007"
tags: [desktop, settings, updater, later]
dependencies: ["005"]
---

# Automatic Update UX

## Problem Statement

The header's up-arrow control and manual Check for updates panel make users initiate a workflow the app should handle automatically. Simplify the update flow after the Settings page is implemented.

## Findings

- Requested on 2026-09-09 for the Later bucket, explicitly after Settings (005).
- The current updater already has launch and periodic checks; review their production behavior and how update availability is surfaced rather than introducing a second polling mechanism.
- The existing Download update and Restart app to update sections are approved and should remain generally visible across app views, not confined to Settings or hidden behind the up-arrow control.
- The separate Install update button is redundant.
- Shared desktop/CLI running and queued transfers must remain protected during installation and restart.

## Proposed Solutions

Automatically detect an outdated version and surface the existing Download update prompt in the shared app layout. Preserve download progress and the restart-to-update section. Consolidate installation into the restart-to-update flow without a separate Install action. Keep routine up-to-date status and any manual diagnostic check in Settings rather than persistent main-view chrome.

### Open Questions for Triage

- Confirm placement of version details and an optional manual retry/check within Settings.
- Define native install/restart sequencing per platform, especially Windows installers that may close the app themselves.
- Define dismissal and reappearance behavior without hiding actionable update states permanently.

## Recommended Action

Keep deferred until 005 (Settings) is complete, then implement this as its related follow-up. Preserve signature verification, explicit download/restart consent, and idle-transfer safeguards.

## Acceptance Criteria

- [x] Work starts after Settings (005).
- [ ] Production launch and periodic checks detect an outdated app without requiring the header up-arrow or a manual check.
- [ ] An available update automatically exposes Download update across Search, Downloads, and Settings.
- [ ] Download progress and Restart app to update remain generally visible in the shared layout.
- [ ] Remove the manual-check up-arrow from the main header and the separate Install update action.
- [x] The user-facing flow is Download update, then Restart to update; implementation safely handles platform-specific installation internally.
- [ ] Running/queued shared transfers block destructive install/restart steps with clear feedback; no automatic restart or download without user consent.
- [ ] Network errors, failed verification, retry, view switching, and restart readiness are covered by tests.

## Work Log

### 2026-09-09 - Requested for Later, After Settings

Recorded the user's preferred automatic detection and two-action update flow. No updater UI or runtime behavior changed.

### 2026-09-09 - Fold Installation Into Restart

Removed the separate Install update action. Restart to update now invokes the existing guarded installer and then restarts automatically. Installation failures keep downloaded bytes retryable; restart failures retry only restart. Duplicate clicks and transfer actions remain blocked while updating. Automatic prompt placement and removing the header arrow remain deferred in this item.
