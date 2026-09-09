# Desktop Roadmap

This is the entry point for desktop priorities and future feature requests. Add later ideas here as they come up; they do not automatically become part of the next implementation.

## Completed: Search Workspace

Implemented Search Workspace with a compact, expandable activity strip. Search and Downloads retain their view state and use the existing shared CLI/desktop task store.

Tracked in [001: Search workspace](../.context/compound-engineering/todos/001-complete-p2-desktop-search-workspace.md).

| Area                | Proposed Scope                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation          | Compact Visuales header with Search and Downloads tabs; Search opens first.                                                                                                       |
| Search              | Full-width result list with explicit multi-selection. Keep query, results, selection, and scroll position when switching tabs.                                                    |
| Selection           | Replace the permanent right panel with a bottom action bar: selected count, clear selection, destination picker, Download and Queue actions. Show only when results are selected. |
| Transfers in Search | Collapsible in-app transfer tray using the shared CLI/desktop task store. Keep it distinct from the selection action bar.                                                         |
| Downloads           | Full-width task table with meaningful names, progress, speed, status, and existing resume/cancel/remove actions. Task IDs are secondary.                                          |
| Task states         | Distinguish queued, running, completed, failed, and interrupted tasks; show errors on the affected task. Do not label cancellation as pause.                                      |
| Layout              | Use available window space, allow list scrolling, and keep action controls reachable at default and minimum supported window sizes.                                               |
| Visual constraints  | Keep teal, JetBrains Mono, 1px corners, restrained font weights, and icon controls with accessible labels/tooltips.                                                               |

### Transfer Tray Decision

Use a compact activity strip while transfers are active or queued, expandable into a short list. Hide it when idle; Downloads remains available for history and failures.

On the Downloads tab, the task table replaces the tray so the same transfers are not shown twice. A failed transfer must still surface a visible indication when the tray collapses or becomes idle.

## Completed: Desktop Settings

[005: Settings page](../.context/compound-engineering/todos/005-complete-p3-desktop-settings.md) adds persistent desktop-only defaults for output folder, concurrent files, connections per file (1-8), and retries per file. The shared Node engine supports resumable parallel range downloads with safe single-stream fallback. Explicit destinations override the default; existing, queued, and resumed tasks keep their recorded options. CLI defaults are unchanged; its existing connection option is now honored.

## Completed: CI Performance

Completed [006: Faster desktop CI builds](../.context/compound-engineering/todos/006-complete-p3-desktop-ci-build-performance.md): shared Rust/npm dependency caching, fewer repeated sidecar builds, and cancellation of superseded validation runs. See [measured cold/warm results](ci-performance.md); no app release was made for this change.

## Completed: Automatic Update UX

Implemented [007: Automatic update UX](../.context/compound-engineering/todos/007-complete-p3-automatic-update-ux.md). Release builds check on launch and every six hours. Available updates, download progress, and restart readiness appear above Search, Downloads, and Settings without a header up-arrow. Installed version, last successful check, routine status, and manual diagnostics live in Settings.

Later hides only an available-update notice until the next scheduled check or app launch; the checked release remains downloadable in Settings. Download and Restart to update still require explicit consent. Signature verification and shared running/queued transfer safeguards remain intact. Included in the v2.0.5 release.

## Later

| Feature                                                                                                                   | Status              | Notes                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Menu bar progress](../.context/compound-engineering/todos/002-pending-p3-menu-bar-progress.md)                           | Requested; deferred | Monitor the same shared transfers outside the main window. Platform coverage and behavior after closing the window need separate triage. |
| [Browse directory contents in Search](../.context/compound-engineering/todos/003-pending-p3-search-directory-browsing.md) | Requested; deferred | Inspect and select individual files while preserving search state.                                                                       |
| [Click-to-preview images](../.context/compound-engineering/todos/004-pending-p3-search-image-previews.md)                 | Requested; deferred | Open an in-app preview from Search or browsed directories.                                                                               |

Only explicitly requested future features belong in this bucket. Keep proposals and open questions separate from accepted requirements. Do not delete deferred ideas unless the user drops them.

## Boundaries

- This pass reorganizes the desktop interface; the Node core and shared state remain the source of truth.
- Directory browsing from option 2 and detailed per-file drill-down from option 3 are not included in the proposed pass.
- Menu bar progress does not implicitly authorize close-to-tray, autostart, notifications, or changing worker lifetime.
- Android remains a separate architecture decision.

## Decisions

- 2026-09-08: User selected option 1 for triage and requested a persistent future-feature bucket, starting with menu bar progress.
- 2026-09-08: User selected the compact, expandable activity strip as the default. Search Workspace scope marked ready; menu bar progress remains deferred.
- 2026-09-08: Search Workspace implemented and verified at default, minimum desktop, and narrow viewports. macOS app rebuilt; menu bar progress remains in Later.
- 2026-09-08: Simplify Search chrome and its expanded activity summary; preserve Downloads. Remove the ambiguous local-engine Connected badge, expire transfer confirmations after four seconds, and add native open-output-folder actions. Directory browsing and image previews added to Later.
- 2026-09-09: Defer updater UX until after Settings. Detect outdated versions automatically, keep Download update and Restart app to update visible across views, and remove the manual-check header arrow and redundant Install button.
- 2026-09-09: Implement Settings with desktop-only defaults, as requested. Leave CLI behavior unchanged; updater UX remains the related follow-up.
- 2026-09-09: User requested working parallel connections in the engine first. Added shared Node range downloading, resumable segments, range/version validation, and a per-process connection budget; unlocked the Settings control. CLI and desktop consume the same implementation.
- 2026-09-09: Centralize transfer defaults in core for CLI and desktop (five files, three connections, three retries). Desktop persists overrides independently and retains Downloads/Visuales as its destination; existing preferences and task options stay unchanged.
- 2026-09-09: Finish updater UX after Settings. Move routine checks into Settings, keep actionable update states global, and remind after Later on the next six-hour check or launch. Retain Download then Restart with native verification and idle-transfer safeguards.
