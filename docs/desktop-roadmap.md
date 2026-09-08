# Desktop Roadmap

This is the entry point for desktop UI priorities and future feature requests. Add later ideas here as they come up; they do not automatically become part of the next implementation.

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

## Later

| Feature                                                                                                                   | Status              | Notes                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Menu bar progress](../.context/compound-engineering/todos/002-pending-p3-menu-bar-progress.md)                           | Requested; deferred | Monitor the same shared transfers outside the main window. Platform coverage and behavior after closing the window need separate triage. |
| [Browse directory contents in Search](../.context/compound-engineering/todos/003-pending-p3-search-directory-browsing.md) | Requested; deferred | Inspect and select individual files while preserving search state.                                                                       |
| [Click-to-preview images](../.context/compound-engineering/todos/004-pending-p3-search-image-previews.md)                 | Requested; deferred | Open an in-app preview from Search or browsed directories.                                                                               |
| [Settings page](../.context/compound-engineering/todos/005-pending-p3-desktop-settings.md)                                | Requested; deferred | Configure default output folder, maximum connections, concurrency, and retries. Other download defaults need triage.                     |

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
