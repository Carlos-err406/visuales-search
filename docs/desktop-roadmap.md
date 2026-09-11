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

## Completed: Dark Mode

Implemented [008: Dark mode](../.context/compound-engineering/todos/008-complete-p3-desktop-dark-mode.md) for v2.0.6. Settings > Appearance offers System, Light, and Dark with immediate desktop-only persistence. System follows live OS changes; explicit choices override them. Theme bootstrap avoids a light flash, and native window appearance follows the choice. Search, Downloads, Settings, update notices, menus, and tooltips share the charcoal/teal palette while preserving 1px corners and JetBrains Mono.

## Completed: Search Browser

Included in v2.0.7. Search work is tracked as four completed implementation items:

| Bucket | Feature                                                                                                                  | Behavior                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1    | [Finder-style Search tree](../.context/compound-engineering/todos/009-complete-p3-search-tree-layout.md)                 | Collapsible folders, indentation, keyboard navigation, and separate selection. Initial grouping requires no directory fetch.                  |
| 2.2    | [Directory contents](../.context/compound-engineering/todos/003-complete-p3-search-directory-browsing.md)                | On-demand inline listings, refresh/retry, and shared Node discovery/cache. Search matches and browsed children merge by URL.                  |
| 2.3    | [Cached image/text previews](../.context/compound-engineering/todos/004-complete-p3-search-file-previews.md)             | Click supported files to preview without starting a transfer. Closing preserves selection and restores focus.                                 |
| 2.4    | [Empty-search library browsing](../.context/compound-engineering/todos/010-complete-p3-empty-search-library-browsing.md) | Empty Search loads parsed listado.html through the shared cache. Starts collapsed, virtualizes large branches, and clearing resets selection. |

Preview limits: PNG/JPEG/GIF/WebP up to 4 MB, UTF-8 text up to 512 KB. The unified `previews` cache retains content for 24 hours, evicts oldest entries above 32 MB, and supports explicit refresh and CLI cache management. Text is inert; remote HTML/scripts are never executed. Visuales keeps its themes, typography, and 1px corners. CLI download behavior is unchanged.

## Completed: Settings Action Layout

Included in v2.0.8: [011: Conditional save/discard footer and header Restore defaults](../.context/compound-engineering/todos/011-complete-p3-settings-action-layout.md). The bottom actions appear only with unsaved changes; Restore defaults is right-aligned in the Settings header and still requires an explicit save. The brief Saved confirmation remains visible in the header. Appearance continues to persist immediately without showing the footer. Browser previews clearly mark transfer settings read-only and cannot create unsavable drafts.

## Implemented: Search Status and Quit Warning

Prepared for v3.0.0:

- [012: Download statuses in Search](../.context/compound-engineering/todos/012-complete-p3-search-download-status.md): compact shared-task labels in search results and library browsing. Exact file progress uses fresh URL metadata; parent/child coverage is explicitly distinguished from whole-folder or individual-file completion.
- [013: Quit warning](../.context/compound-engineering/todos/013-complete-p3-quit-download-warning.md): native Keep open/Quit confirmation for running or queued work, fresh serialized ownership checks, and unchanged CLI worker lifetime. Idle exits and authorized updater restarts remain prompt-free. Cross-platform native dialog smoke testing remains a release check.

## Implemented: Settings Exclusions

[014: Download exclusions in Settings](../.context/compound-engineering/todos/014-complete-p3-desktop-download-exclusions.md) adds a persistent glob-pattern editor under Transfers with Save, Discard, and Restore defaults. New desktop downloads and queued tasks receive the saved patterns through the shared CLI engine; existing/resumed tasks and CLI defaults stay unchanged. Missing exclusions in older preferences default to an empty list. As with the CLI, exclusions filter folder contents, while explicitly selected files are still downloaded. Implemented locally, not yet released.

The editor now uses ordered gitignore-style rules: `*.jpg` followed by `!poster.jpg` keeps the poster. Comments, escapes, directory rules, and root-relative paths share the Node matcher with CLI `--ignore`; repeated rules retain order. Legacy brace/comma shorthand remains supported. See [Ignore rules](../README.md#ignore-rules).

Prepared for v3.0.0 alongside clickable Settings help popovers. Help opens on click, tap, or keyboard activation and closes with Escape, its close button, or an outside click. Only one help panel can be open. The major version reflects removal of the CLI `--exclude` flag; use `--ignore` instead. Stored tasks and preferences remain compatible. Menu bar progress is not included.

## Later

| Bucket | Feature                                                                                       | Status                                             | Notes                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      | [Menu bar progress](../.context/compound-engineering/todos/002-ready-p3-menu-bar-progress.md) | Included in 3.1.0; native Windows/Linux QA pending | Mini Downloads popup on macOS/Windows with folder, interrupt/resume, and filter controls; native status menu on Linux. Preserve close/quit behavior. [Verification](menu-bar-progress.md). |

Only explicitly requested future features belong in this bucket. Keep proposals and open questions separate from accepted requirements. Do not delete deferred ideas unless the user drops them.

## Boundaries

- This pass reorganizes the desktop interface; the Node core and shared state remain the source of truth.
- Search tree presentation (2.1), directory listings (2.2), cached previews (2.3), and empty-search library browsing (2.4) are included in v2.0.7.
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
- 2026-09-09: Add desktop dark mode to the Later bucket. Theme preferences and native window appearance remain open for triage.
- 2026-09-09: User requested shipping dark mode. Implement System (default), Light, and Dark with desktop-only persistence and native window synchronization; leave CLI and transfer settings unchanged.
- 2026-09-10: Split Search work into 2.1 Finder-style collapsible/indented tree presentation, 2.2 actual directory listings, and 2.3 cached image and text previews (formerly item 3). Keep menu bar progress as item 1. No application changes in this bucket update.
- 2026-09-10: User approved beginning the Search work. Implemented 2.1-2.3 with shared-core discovery/previews, thin native transport, persisted bounded preview caching, and full engine/native/UI checks. Menu bar progress remains deferred; no release requested in this pass.
- 2026-09-10: Add empty-search library browsing as deferred item 2.4. Fix preview tooltip layering and reserve folder refresh controls for listings already loaded; disclosure arrows load unopened folders.
- 2026-09-10: Add Settings action layout to the bucket. Search folder selection now cascades through known descendants and newly loaded contents; partially selected branches show an indeterminate checkbox. Excluding a child removes whole-folder ancestor targets so it remains excluded from downloads.
- 2026-09-10: Remove Search tree chevrons; clicking folder rows toggles expansion while checkboxes select. Expanded folders use open-folder icons. User explicitly dropped folder sizes; no size calculations or extra scans are included.
- 2026-09-10: Implement item 2.4. Initial and cleared Search show the full parsed library with collapsed roots, session reuse of the shared cache, virtualized large branches, and explicit loading/error/retry states. Clearing a query clears its selections; late search responses cannot overwrite library browsing. Settings action layout and menu bar progress stay deferred.
- 2026-09-10: Prepare v2.0.7 with Search browsing and cached previews. Checkboxes share a fixed gutter; only names/icons are indented. Equivalent URL encodings merge into one row, known children use a quiet refresh spinner, and expanding/collapsing across the virtualization threshold preserves scroll position. Settings action layout and menu bar progress remain deferred.
- 2026-09-10: Implement Settings action layout on user request. Save/Discard appear only while dirty; Restore defaults moves to the right of the header. Preserve explicit saves and immediate theme persistence. Menu bar progress is the only remaining deferred feature.
- 2026-09-10: User requested pushing Settings without a release and planning menu bar progress. Approved all desktop platforms with status-only integration and unchanged close/quit behavior. Written plan covers shared Node status, native polling and menu rendering, Downloads navigation, and platform verification; implementation has not started.
- 2026-09-10: Add download statuses on Search folder/file rows to the bucket. Presentation and folder aggregation need triage; no implementation or release work requested.
- 2026-09-10: Add an alert when quitting with downloads in progress to the bucket. Track separately from status-only menu bar progress; no lifecycle changes implemented.
- 2026-09-10: Add desktop Settings support for CLI `--exclude` / `--ignore` patterns to the bucket. Reuse shared-engine matching and persist desktop defaults; no implementation requested.
- 2026-09-11: User approved bucket items 2 and 3. Implement Search transfer status labels and a native quit warning; menu bar progress and Settings exclusions remain deferred. No release requested.
- 2026-09-11: Simplify completed Search statuses: show completion only on exact transfer targets, without "Contains completed" on ancestors or "Folder transfer completed" on descendants. Other transfer states are unchanged.
- 2026-09-11: Clarification: remove every "Contains ..." label, not just completion. Ancestors no longer aggregate child transfer states; their own direct transfer status remains visible.
- 2026-09-11: Implement bucket item 4, persistent desktop exclusions matching CLI `--exclude` / `--ignore`. Preserve shared-engine matching, explicit-file precedence, legacy preferences, existing task options, and CLI defaults. No release requested; menu bar progress remains deferred.
- 2026-09-11: Refactor exclusions into ordered gitignore-style rules across core, CLI, and desktop. Preserve exceptions and duplicate rules in task snapshots and preferences; use each downloaded folder as the rule root. No release requested.
- 2026-09-11: Remove the redundant CLI `--exclude` flag at the user's request. Only `--ignore` is accepted; detached and resumed tasks use it while preserving the existing stored `exclude` array for compatibility.
