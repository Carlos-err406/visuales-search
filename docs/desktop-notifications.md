# Desktop Download Notifications

Approved September 14, 2026. Desktop-only; no CLI notifications or changes to worker lifetime.

## Behavior

- One native alert when a desktop-started or desktop-resumed transfer completes or fails after its retries. Never one alert per file.
- Each transfer notifies independently of running, queued, or interrupted neighbors; it does not wait for an empty queue.
- Deliver only while the main window is unfocused. Foreground events are consumed, not deferred until the user leaves.
- Settings > Notifications has independent Completed downloads and Failed downloads preferences, enabled by default. Save, Discard, and Restore defaults follow the existing Settings workflow.
- Existing preference documents gain the defaults on read without being rewritten. CLI defaults and recorded task options do not change.
- Manual interruption, deletion, quitting, CLI-only activity, and historical records do not generate events. Retrying a failed transfer is a new eligible run.
- Events are private to the sidecar session, drained once, capped at 100 pending events, and expire after five minutes to tolerate temporary stalls. Sidecar restarts intentionally do not replay old events.
- OS notification permissions, Focus/Do Not Disturb, and delivery policy remain authoritative. Native delivery errors are logged without retrying or interrupting downloads.
- Notifications contain the transfer name, not the local destination or detailed server errors.
- Completion notifications offer **Show in Finder** on macOS, **Show in File Explorer** on Windows, or **Open containing folder** on Linux. The action opens the completed transfer's output directory: the downloaded folder itself for a folder transfer, or the containing directory for a standalone file. It does not depend on the current selection or subsequently changed defaults.
- Clicking a completion banner uses the same destination on supporting platforms. Failed notifications open that task in Downloads instead. Missing or moved output directories present Downloads with a warning; the action never recreates a folder or starts another download.

## Implementation

The Node worker sends a terminal IPC event only after shared-core task persistence finishes, flushing it before exit. Its owning sidecar queues it once. A private `notifications.take` RPC loads saved preferences and drains the queue; a dedicated native polling loop consumes it even in the foreground, independently of slow or failed task snapshots. Task events wake both loops; stopping the monitor stops both. Neither React window creates OS notifications, avoiding duplicate main/tray alerts and background JavaScript timer throttling. Native logs record submission, suppression, or delivery failure using task IDs, without paths or filenames.

The terminal event snapshots the completed task's output directory. Native action records hold that literal path in memory, keyed by a single-use opaque session token. Paths are never embedded in OS notification payloads, decoded as URLs, or interpolated into shell commands. The registry keeps at most 100 records, expires them after 24 hours, and cancels associated timer/Linux listener work when consumed, dismissed, expired, or evicted. App exit loses all action records. There is no persistent activation protocol or app relaunch behavior.

macOS uses Apple's UserNotifications categories and delegate through objc2; Windows uses the already-locked `tauri-winrt-notification` 0.7.3 action callbacks; Linux retains `notify-rust` 4.17. This keeps the current Rust minimum version and requires no new webview permissions. Transfer mechanics remain in Node. macOS authorization/delivery callbacks recheck lifecycle, event age, and focus before presenting, and UI navigation is dispatched to the main thread.

## Platform Limits

- **macOS:** bundled apps use their own bundle identifier and request alert authorization from Notification Center. The Finder action requires an unlocked session and does not foreground Visuales unless opening the destination fails. It may appear under the banner's Options menu, depending on macOS presentation settings. A bare `cargo run` executable retains legacy notification-only delivery, without an inert action button; use a signed bundle to test real actions. Permission denial is respected without falling back to another identity.
- **Windows:** delivery uses the installed app's AppUserModelID, with a Show in File Explorer button and banner activation callback. Validate on an installed Windows build, not an unregistered development executable. A dismissed/timed-out banner can remain in Notification Center; timeout alone does not discard the action record.
- **Linux:** supporting notification servers receive both a named action and default banner action. Body markup is escaped. Servers without action support still receive the notification but may not expose a clickable action. Closing the notification ends its listener.

Actions are session-only on all platforms. Older Notification Center entries can outlive their handler after app exit, expiry, or eviction and then do nothing. Notification settings, Focus/Do Not Disturb, and the OS decide delivery; this implementation does not override them.

References: [Apple actionable notifications](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types), [Apple notification delegate](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate), [Windows toast adapter](https://github.com/tauri-apps/winrt-notification), [notify-rust 4.17 API](https://docs.rs/notify-rust/4.17.0/notify_rust/).

## Verification

- Sidecar integration: fast completion, single consumption despite repeated snapshots/worker exit, failure, retry, interruption, CLI-only completion, fresh sessions, and independent saved preferences.
- Settings: legacy migration, strict boolean validation, persistence, restore/discard, and browser reload.
- Native policy: background/focus gating, age bounds, failed/completed titles, and rejection of nonterminal events.
- Native monitoring: notification polling continues while a snapshot is blocked or failing, responds immediately to task events, and stops on shutdown.
- Action routing: independent destination snapshots, defaults changing after completion, single consumption, unknown/dismissed actions, bounded eviction, expiry, and listener cancellation. Literal paths with spaces, percent signs, and punctuation are preserved; absent destinations do not create directories.
- macOS native category/content: one authenticated Finder action, no foreground activation flag, no paths in userInfo, and no completion action for failures. Delegate state is thread-safe.
- Before release: installed-app delivery/action checks on Windows/Linux, system-denied notifications, and macOS production-bundle activation. Automated tests intentionally do not send real desktop alerts.

Local validation: 153 Node tests, 13 native tests, desktop production build, lint, and browser UI checks passed. The first browser run timed out in the pre-existing tray filter test; a clean rerun passed. Light/dark Settings screenshots and 1240/760/390px checks confirm reachable controls, no horizontal overflow, and 1px checkbox corners. On September 14 the user enabled macOS notification permission, confirmed the Visuales native preview appeared, and approved shipping. Windows/Linux delivery and Linux activation still require manual platform verification.

Debug builds accept `--notification-preview` to submit one clearly labeled sample after launch, without a download or task-history entry. It bypasses app focus/preferences for explicit testing, but never bypasses OS notification policy. Release builds do not include this preview path. macOS application identity is initialized once per process because the native adapter rejects repeated initialization.

### Completion Action Validation (September 18)

The native suite passes 26 tests and `npm run check` passes all 281 Node/CLI/sidecar tests, including independent completion destinations and unchanged preferences/eligibility. The sandboxed Node run could not bind local test servers; rerunning with local-server/process access passed. Windows/Linux native runtime checks remain outstanding on this macOS workstation.

For an isolated macOS action test, run `node scripts/preview-macos-notification.mjs` from the repository root after `npm run sidecar:prepare`. It builds and ad-hoc signs a separate **Visuales Notification Preview.app** in `.cache/notification-action-preview/`, sends one clearly labeled sample, and exits after three minutes. Allow its separate notification permission if prompted, then choose Show in Finder. The sample opens Downloads, starts no sidecar or downloads, and never reads or changes task history. Logs are in that directory's `preview.log`. To repeat after the preview exits, run the command again.

The user confirmed the preview's **Show in Finder** action opened Downloads; the native log also recorded successful delivery and activation. Production was untouched. The dev Lost transfer was interrupted with permission and its partial files retained. Completion actions are implemented locally, not released.
