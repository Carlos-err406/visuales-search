# Desktop Download Notifications

Approved September 14, 2026. Desktop-only; no CLI notifications or changes to worker lifetime.

## Behavior

- One native alert when a desktop-started or desktop-resumed transfer completes or fails after its retries. Never one alert per file.
- Deliver only while the main window is unfocused. Foreground events are consumed, not deferred until the user leaves.
- Settings > Notifications has independent Completed downloads and Failed downloads preferences, enabled by default. Save, Discard, and Restore defaults follow the existing Settings workflow.
- Existing preference documents gain the defaults on read without being rewritten. CLI defaults and recorded task options do not change.
- Manual interruption, deletion, quitting, CLI-only activity, and historical records do not generate events. Retrying a failed transfer is a new eligible run.
- Events are private to the sidecar session, drained once, capped at 100 pending events, and expire after 30 seconds. Sidecar restarts intentionally do not replay old events.
- OS notification permissions, Focus/Do Not Disturb, and delivery policy remain authoritative. Native delivery errors are logged without retrying or interrupting downloads.
- Notifications contain the transfer name, not the local destination or detailed server errors.

## Implementation

The Node worker sends a terminal IPC event only after shared-core task persistence finishes, flushing it before exit. Its owning sidecar queues it once. A private `notifications.take` RPC loads saved preferences and drains the queue; the native task monitor consumes it even in the foreground. Neither React window creates OS notifications, avoiding duplicate main/tray alerts and background JavaScript timer throttling.

Native delivery uses `notify-rust` 4.17, the same underlying desktop adapter used by Tauri's notification plugin, directly so supported Linux activation can be handled. This keeps the current Rust minimum version and does not require new webview permissions. Transfer mechanics remain in Node.

## Platform Limits

- **macOS:** delivery uses the Visuales bundle identifier. Validate with a registered, installed app bundle and system notifications enabled; a bare `cargo run` binary is not an equivalent notification test. The adapter exposes no task-specific click callback.
- **Windows:** delivery uses the installed app's AppUserModelID. Validate with the installed build, not an unregistered development executable. The adapter exposes no task-specific click callback.
- **Linux:** supporting notification servers get an Open download action that presents the main window and selects that task in Downloads. The action listener expires after five minutes or app exit; older notification-center entries may remain without an active handler. Body markup is escaped. Delivery still works on servers without actions.

Do not claim macOS/Windows notification clicks select a task. That requires a separate platform activation implementation or a newer adapter with a verified compatible Rust baseline.

References: [Tauri notification guide](https://v2.tauri.app/plugin/notification/), [Tauri desktop adapter](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/src/desktop.rs), [notify-rust 4.17 API](https://docs.rs/notify-rust/4.17.0/notify_rust/).

## Verification

- Sidecar integration: fast completion, single consumption despite repeated snapshots/worker exit, failure, retry, interruption, CLI-only completion, fresh sessions, and independent saved preferences.
- Settings: legacy migration, strict boolean validation, persistence, restore/discard, and browser reload.
- Native policy: background/focus gating, age bounds, failed/completed titles, and rejection of nonterminal events.
- Before release: installed-app notification delivery on each OS, system-denied notifications, and Linux action navigation. Automated tests intentionally do not send real desktop alerts.

Local validation: 153 Node tests, 13 native tests, desktop production build, lint, and browser UI checks passed. The first browser run timed out in the pre-existing tray filter test; a clean rerun passed. Light/dark Settings screenshots and 1240/760/390px checks confirm reachable controls, no horizontal overflow, and 1px checkbox corners. On September 14 the user enabled macOS notification permission, confirmed the Visuales native preview appeared, and approved shipping. Windows/Linux delivery and Linux activation still require manual platform verification.

Debug builds accept `--notification-preview` to submit one clearly labeled sample after launch, without a download or task-history entry. It bypasses app focus/preferences for explicit testing, but never bypasses OS notification policy. Release builds do not include this preview path. macOS application identity is initialized once per process because the native adapter rejects repeated initialization.
