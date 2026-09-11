# Tray and Menu Bar Progress

Visuales keeps a tray icon while the desktop process runs. macOS and Windows use a 360px-wide, 560px-high transfer popup on left click, constrained to the display work area; right click opens a native menu. Linux uses the native menu because tray pointer events and bounds are not portable across indicator hosts.

The popup follows the saved light/dark/system appearance. It defaults to Active (running and queued), with a status filter for all transfers or running, queued, interrupted, failed, and completed tasks. Records come from the same CLI/desktop Node task store, with byte progress matching Downloads and fresh speed. Completed-file counts are secondary; six small files must not make a folder containing a large video look nearly finished. Unknown byte totals have no bar. The list scrolls without moving its header or Quit action.

Rows are read-only. Explicit icon buttons open the download folder, interrupt running/queued work, or resume interrupted/failed tasks using the existing desktop commands. Pending actions are guarded against repeated clicks; failures stay inline. Native updater/quit guards still apply to resumed tasks. Completed tasks expose only the folder action. Open Downloads opens the main view without filters. Escape closes an open status menu first, then dismisses the popup; clicking outside and popup close also dismiss it. Quit uses the existing active-download warning and worker ownership rules.

This does not add close-to-tray, autostart, a daemon, notifications, or persistent background downloading after app exit. Historical failures are available through popup filters but do not keep the native tray in a permanent error state. The native fallback menu remains status-only.

## Data and Lifecycle

The header contains icon-only status filtering and Open Downloads controls, with tooltips. A small indicator marks filters other than Active. Combined speed sits in the footer; there is no separate filter/count row.

- `tasks.snapshot` reads and reconciles the shared store once, returning task records and a pure core summary. Existing CLI/RPC contracts remain available.
- Native polling continues independently of browser timers. Popup and main-window reads share a two-second, single-flight cache, including errors. Task changes invalidate it; manual refresh bypasses its age.
- Aggregate speed is omitted if any running task lacks a fresh numeric speed. Per-transfer percentages use the shared byte-progress helper used by Downloads. No combined percentage across transfers is inferred. The popup summarizes cached task records in shared core code, so frontend changes do not require restarting active download workers.
- Sidecar suspension blocks reads before and after fetching. Quit stops the monitor before shutting down owned workers. Authoritative updater and quit snapshots bypass the display cache.
- Native menu handles remain stable, with labels changed only when needed. Unsupported tray hosts do not fail application startup.
- Pending Downloads navigation survives frontend initialization/reload until consumed.

## Verification

Automated checks: `npm run check`, `cargo test --workspace`, `BROWSER_CHANNEL=chrome npm run test:desktop` (omit the channel override when Playwright browsers are installed).

Native macOS: `npm run test:tray:macos`. Run on an interactive desktop and do not change focus during the test. It uses a temporary app bundle and fixture snapshots, never the user's downloads or installed app. Start the frontend with `npm run dev -w visuales-desktop` on port 1420 to also render the popup in the fixture; native visibility/focus/navigation assertions do not require a live engine.

Before release, manually verify Windows tray placement with top/bottom/side taskbars, multiple displays/DPI, and focus dismissal; Linux indicator menus under KDE and GNOME with AppIndicator support; Linux startup with no tray host; macOS menu-bar appearance on light/dark backgrounds; open-menu refresh stability; live CLI activity; and updating/quit with active work. Local macOS tests do not establish Windows/Linux native correctness.
