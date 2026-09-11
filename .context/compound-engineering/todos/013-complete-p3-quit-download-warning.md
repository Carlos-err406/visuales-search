---
status: complete
priority: p3
issue_id: "013"
tags: [desktop, downloads, ux, lifecycle]
dependencies: []
---

# Quit Warning During Downloads

## Problem Statement

Alert the user before quitting the app when downloads are in progress, allowing them to cancel quitting.

## Findings

- Initially deferred; user approved implementation on 2026-09-11.
- Separate from menu bar progress, whose initial scope preserves close/quit behavior.
- CLI and desktop share task state. The warning must accurately describe what quitting will affect rather than assume every transfer stops.

## Proposed Solutions

- Show a confirmation with Cancel and Quit actions when an app quit is requested during active downloads.
- During triage, establish which exit paths need interception, whether closing a window actually quits on each platform, and how queued tasks or independently running CLI tasks should be treated.

## Recommended Action

Implemented a native confirmation for main-window close and normal application Quit, covering running and queued tasks. Keep open/dismiss cancels; Quit stops this instance's workers and keeps partial files resumable. Separate CLI/other-instance transfers continue. Idle quits and authorized updater restarts do not prompt.

## Acceptance Criteria

- [x] Quitting with downloads in progress shows a warning before the app exits.
- [x] Cancelling the quit leaves the app and transfers running.
- [x] Confirming the quit follows the agreed exit behavior and accurately communicates its effect on downloads.
- [x] No warning appears when there are no relevant active downloads.
- [x] Applicable quit paths are covered on macOS, Windows, and Linux without duplicate prompts.
- [x] No implicit close-to-tray, background mode, or worker-lifetime changes are introduced.

## Work Log

### 2026-09-10

- Added as deferred desktop bucket item 3 at the user's request.
- No implementation or release actions performed.

### 2026-09-11

- Implemented on `codex/search-status-quit-warning`; not released.
- Serialized Node snapshot reports ownership; the native transfer gate prevents starts/resumes racing the decision. Duplicate quit events coalesce. Unknown status requires an explicit confirmation rather than silently exiting.
- Native unit tests verify idle/owned/external warning text, cancellation/dismissal, duplicate-request handling, and shutdown gating. Sidecar integration covers pending starts, queued workers, read-only snapshots, resumability, and independently running CLI work.
- macOS builds and native tests pass. All platforms use the same Tauri event/dialog path; actual OS dialog interactions on macOS, Windows, and Linux still need manual smoke testing before release. Force-kill and OS termination signals cannot be protected by a quit dialog.
