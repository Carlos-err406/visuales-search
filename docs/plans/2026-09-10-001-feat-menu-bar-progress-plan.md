---
title: Cross-platform menu bar and tray progress
type: feat
status: draft
date: 2026-09-10
origin: .context/compound-engineering/todos/002-pending-p3-menu-bar-progress.md
---

# Cross-Platform Menu Bar and Tray Progress

## Scope and Requirements

Show transfer status without bringing the main window forward. The user approved macOS, Windows, and Linux, **status-only while the app is running**, with no change to close/quit behavior. This document plans the feature; it does not authorize implementation or a release.

- R1: Native macOS menu bar item and Windows/Linux notification-area item.
- R2: Reflect the shared CLI/desktop task store, including externally started CLI tasks.
- R3: Represent running, queued, failed, interrupted, idle, stale, and disconnected states honestly.
- R4: Open the existing Downloads view, including when the window is minimized.
- R5: Preserve worker ownership, close/quit behavior, updater safeguards, and existing CLI commands/defaults.
- R6: Avoid extra network requests, overlapping task reconciliation, and dependence on foreground browser timers.

Non-goals: close-to-tray, autostart, a daemon, notifications, transfer controls inside the menu, Android, taskbar/Dock progress, a second webview, or new settings. No version bump, tag, or publishing as part of this plan.

## Proposed UX

Use the existing Visuales mark adapted for small native icons. Keep the icon present while the app is running; use distinct static idle, active, queued, and unavailable treatments without continuous animation. Historical failed tasks do not keep the icon permanently alarming.

| Surface             | Proposed presentation                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| macOS               | Monochrome template icon, compact running-count title while active, native menu on click.                  |
| Windows             | Tray icon, short status tooltip, native context menu. No adjacent text requirement.                        |
| Linux               | Tray icon and native context menu as the complete interface. No tooltip or custom click dependency.        |
| No usable tray host | App continues normally; Downloads remains available. Log a bounded diagnostic rather than failing startup. |

Menu order:

1. Non-actionable summary: running/queued counts and current combined speed.
2. Up to three running transfers, stable ordering, truncated names, and completed/total file counts where available. If more are running, show a remaining count.
3. Historical failed/interrupted counts when nonzero, explicitly labeled as history, not new alerts.
4. Separator, **Open Downloads**, **Quit Visuales**.

Idle reads "No active transfers"; queued-only reads "Waiting in queue". Initial connection reads "Loading transfers". A failed refresh reads "Transfer status unavailable" instead of presenting stale progress as live. Navigation remains available in all states.

Do not invent an aggregate byte percentage: the current task record does not establish that every folder byte total is complete or exact. Prefer file counts once discovery has supplied a total; otherwise show "Discovering files" or "Downloading". Unknown speed is unavailable, not zero. Explicit cancellation stays interrupted/canceled, never becomes a failed-transfer alert.

These presentation choices are the proposed implementation baseline, not previously approved pixel-level designs. Native menus use OS typography and geometry, rather than trying to impose the web app's 1px corner rule.

## Context and Research

- `packages/core/src/download/tasks.ts`: persistent task records, two-second progress writes, reconciliation, and shared locking. A listing can involve OS process discovery; duplicated polling has a real cost.
- `apps/sidecar/src/main.ts`: `tasks.list` calls the shared core; `tasks.changed` comes from sidecar-owned changes, so it cannot replace polling for CLI activity. Mutations and update preparation have deliberate ordering.
- `apps/desktop/src/use-transfers.ts`: two-second browser polling and event-triggered refresh, paused during update installation.
- `apps/desktop/src/task-view.ts`: task names, ten-second speed freshness, and presentation helpers. Reuse matching rules; do not duplicate download semantics in Rust.
- `apps/desktop/src-tauri/src/sidecar.rs`: lazy Node bridge, request multiplexing, task-change forwarding, shutdown, and updater suspension that prevents respawn.
- `apps/desktop/src-tauri/src/lib.rs`: thin command adapter and existing exit cleanup; no close-to-tray interception.
- `apps/desktop/src-tauri/src/updates.rs`: transfer/update synchronization must retain authoritative uncached reads.
- `Cargo.lock` resolves Tauri 2.11.5. Its tray feature is not enabled for this app yet.
- No matching `docs/solutions/` material was found. The existing Node sidecar migration plan and roadmap establish the shared-engine boundary.

Official references: [Tauri system tray](https://v2.tauri.app/learn/system-tray/) and [Tauri 2.11.5 TrayIcon API](https://docs.rs/tauri/2.11.5/tauri/tray/struct.TrayIcon.html). Enable the `tray-icon` feature. Linux lacks tray tooltips and tray mouse events; Windows lacks tray titles. Linux titles are host-dependent and must not carry essential information. Retain the tray handle for app lifetime and keep its menu attached. macOS supports template icons; atomic icon/template replacement avoids intermediate redraws.

## Architecture

The Node core remains authoritative. Add a pure, clock-injected transfer-summary function and an additive sidecar snapshot method returning tasks plus their summary from one core read. Keep existing `tasks.list` and CLI contracts intact.

A small native coordinator owns periodic snapshot refresh while the app is running. It performs one request at a time, coalesces task-change notifications, and shares the same short-lived snapshot with the frontend's `list_download_tasks` command. Preserve the public frontend response shape. This prevents tray polling from doubling disk/process reconciliation. Authoritative mutation and updater checks must bypass this display cache.

Use a two-second refresh cadence after the previous read finishes; do not queue missed ticks. Coalesced local changes invalidate the display snapshot. A successful fresh read clears unavailable state. Expire speed after ten seconds, matching existing UI behavior; never replay stale speed after sleep or IPC failure. Slow reads must not block the OS main thread. Render only changed menu labels/icons and retain stable menu-item identities so an open menu does not flicker.

During updater suspension or exit, stop the monitor before bridge shutdown. It must not respawn the sidecar, alter the active-transfer gate, or mark old data idle. On a recoverable install error, resume through the existing update recovery path. React only consumes status and navigation; it does not drive native tray refresh.

## Implementation Units

- [ ] **1. Shared summary and snapshot contract**

  Files: create `packages/core/src/download/transfer-summary.ts` and `test/transfer-summary.test.mjs`; modify `packages/core/src/index.ts`, `apps/sidecar/src/main.ts`, and `test/sidecar.test.mjs`.

  Produce counts, fresh numeric speed, and a bounded list of named running transfers from one task list. Reuse or extract only directly overlapping pure presentation rules from `apps/desktop/src/task-view.ts`; update `test/desktop-task-view.test.mjs` if that helper moves. No new task-store fields, migration, or download algorithm changes. Treat the snapshot method as read-only alongside `tasks.list`, without weakening mutation ordering.

  Tests: mixed CLI/desktop tasks, empty history, queue-only, canceled versus failed, unknown totals, missing/invalid numeric progress, non-finite speed, timestamp expiry, Unicode/long names, deterministic order, and old task records without overall progress. Verify one core list operation per snapshot and unchanged legacy RPC responses. Implement summary behavior test-first.

- [ ] **2. Native snapshot coordinator**

  Depends on unit 1. Files: create `apps/desktop/src-tauri/src/task_monitor.rs` with inline Rust tests; modify `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/sidecar.rs`, and `apps/desktop/src-tauri/src/updates.rs` only at lifecycle integration points. Review `apps/desktop/src/use-transfers.ts` for compatibility, preserving its action/error behavior.

  Own a cancellable, single-flight refresh cycle, cache successful display snapshots, and coalesce invalidations. Keep the frontend command returning task records. Do not route `tasks.prepareUpdate` through the cache. Use injected fetching/time for tests rather than requiring a real OS tray.

  Tests: simultaneous frontend/tray refresh requests share a read; changes during a read cause at most one follow-up; failures and timeouts clear live speed; CLI activity appears without a sidecar event; successful reconnection recovers; suspend/exit cancels polling; late responses cannot resurrect shutdown state; installation failure resumes monitoring safely. Existing Rust updater and sidecar shutdown tests remain green.

- [ ] **3. Native tray rendering and Downloads navigation**

  Depends on unit 2. Files: create `apps/desktop/src-tauri/src/tray.rs` with inline Rust tests and small assets under `apps/desktop/src-tauri/icons/tray/`; modify `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock`, `apps/desktop/src-tauri/src/lib.rs`, and `apps/desktop/src/main.tsx`. Add navigation coverage in `test/desktop-ui.smoke.mjs`.

  Enable the tray feature, retain one tray/menu instance, apply status diffs, and use native menu events as the cross-platform action contract. Keep unsupported platform calls behind target gates. Menu labels are inert text and never include complete URLs or output paths. Marshal native UI work onto the supported UI thread.

  Open Downloads unminimizes, shows, and focuses the existing main window, then selects Downloads. Register the frontend listener early and preserve pending navigation until the UI is ready; clean up listeners across reload/unmount. Quit follows the existing app exit path. Do not intercept window close or create a background-only mode.

  Tests: rendering for every status, unchanged snapshots do not rebuild menus, count/name truncation, single menu-action dispatch, navigation before frontend readiness, minimized-window navigation, and correct cleanup. Browser tests cover navigation only, not native tray rendering.

- [ ] **4. Platform verification and documentation**

  Depends on units 1-3. Update `docs/desktop-roadmap.md` and the originating todo only after verification; record manual native checks in `docs/menu-bar-progress.md`. Review `.github/workflows/desktop.yml` and `.github/workflows/desktop-release.yml` for tray dependency coverage, changing them only if required.

  Verify macOS ARM/Intel, Windows, and Linux build compatibility. Native checks: idle/running/queued/failed/disconnected, live CLI-started work, minimizing and returning to Downloads, light/dark menus, high-DPI icons, open-menu stability, sidecar restart, updater suspension, and close/quit with active work. Characterize existing close behavior first and compare afterward. App-owned workers must retain current cleanup behavior; independent CLI workers must not be stopped.

  On Linux verify a supported StatusNotifier/AppIndicator host (KDE and a GNOME session with indicator support where available), plus graceful behavior without one. Existing Linux CI installs `libayatana-appindicator3-dev`, but headless compilation does not prove tray visibility. Do not claim untested native platforms as visually verified.

## Risks and Deferred Verification

- Process-list reconciliation can be slow on Windows; single-flight display polling must not create request storms or block the UI.
- Menu updates while the native menu is open vary by OS. Validate that stable item updates remain readable; avoid recreating menus or using animation as a workaround.
- macOS title width and small-icon legibility require a native visual pass. Exact assets/title length can be refined then without changing the contract.
- Linux desktop environments may hide or omit tray support. This feature is best-effort on unsupported hosts; never force-install shell extensions.
- The current task schema does not guarantee exact byte totals. True aggregate byte percentage is deferred rather than inferred from incomplete data.
- Keep default close/quit behavior. If adding a tray changes platform exit defaults, explicitly preserve the characterized baseline rather than silently enabling background persistence.
- No release is part of this work until separately requested.
