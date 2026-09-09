---
status: complete
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

### Decisions

- Installed version, last successful check, routine status, errors from checks, and manual retry/check live in Settings.
- Preserve the existing native install/restart sequencing, including Windows installers that may close the app themselves. No installer changes are needed for this UI pass.
- Later hides an available-update notice until the next six-hour check or app launch. The checked release stays available to download in Settings. Progress, verification/download errors, and restart readiness cannot be dismissed.

## Recommended Action

Approved for implementation after completed Settings (005). Use the existing updater lifecycle and shared app layout; preserve signature verification, explicit download/restart consent, and idle-transfer safeguards.

## Acceptance Criteria

- [x] Work starts after Settings (005).
- [x] Production launch and periodic checks detect an outdated app without requiring the header up-arrow or a manual check.
- [x] An available update automatically exposes Download update across Search, Downloads, and Settings.
- [x] Download progress and Restart app to update remain generally visible in the shared layout.
- [x] Remove the manual-check up-arrow from the main header and the separate Install update action.
- [x] The user-facing flow is Download update, then Restart to update; implementation safely handles platform-specific installation internally.
- [x] Running/queued shared transfers block destructive install/restart steps with clear feedback; no automatic restart or download without user consent.
- [x] Network errors, failed verification, retry, view switching, and restart readiness are covered by tests.

## Work Log

### 2026-09-09 - Requested for Later, After Settings

Recorded the user's preferred automatic detection and two-action update flow. No updater UI or runtime behavior changed.

### 2026-09-09 - Fold Installation Into Restart

Removed the separate Install update action. Restart to update now invokes the existing guarded installer and then restarts automatically. Installation failures keep downloaded bytes retryable; restart failures retry only restart. Duplicate clicks and transfer actions remain blocked while updating. Automatic prompt placement and removing the header arrow remain deferred in this item.

### 2026-09-09 - Approved and Implemented UI

User requested Finish updater UX. Removed the header arrow, moved diagnostics to Settings, and kept actionable update states above all app views. The existing six-hour polling mechanism also retries failed initialization; debug builds retain manual-only remote checks. Later dismissals are session-local and do not hide a deferred download from Settings. A download attempt restores the shared notice so progress and errors stay reachable.

### 2026-09-09 - Verification Complete

- Lint and all 111 engine/sidecar tests passed; the desktop production build passed.
- Browser smoke tests passed with the native bridge mocked: launch and six-hour checks, initialization/network failures, unsupported installs, Later across views/checks/launches, explicit consent, failed verification and retry, unknown-size progress, active/queued guards, install/restart failure recovery, and duplicate-click prevention.
- Screenshots and overflow checks passed at 1240x820, 760x620, and 390x844. Update controls remain reachable when download settings fail to load. Removed a negative folder-picker margin that caused horizontal Settings overflow at the minimum width.
- All four native tests passed. Signature checks accepted valid bytes and rejected wrong-key and tampered artifacts.
- No real update was downloaded or installed during UI testing. Native updater installation code and shared CLI/core behavior are unchanged. This feature is implemented locally, not yet released.

### 2026-09-09 - Release Requested

User approved shipping the completed feature. Prepared the shared v2.0.5 patch release through the existing PR validation and automated publishing workflow. CLI behavior remains unchanged.
