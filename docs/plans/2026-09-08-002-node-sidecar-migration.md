# Node Core and Desktop Sidecar

Supersedes the Rust core rewrite in `2026-09-08-001-refactor-rust-core-tauri-desktop-plan.md`.

The Node downloader is the source of truth. Move its existing implementation into `packages/core` and consume it from the terminal CLI and desktop sidecar. Keep Rust limited to Tauri host integration.

## Runtime

The desktop sends versioned JSON-RPC requests over a private child process's stdin/stdout. Diagnostics use stderr. The bundled Node executable runs the bundled sidecar script without resolving an installed CLI or relying on the user's PATH. Each download uses a separate worker so cancellation, per-task state, and the existing PID-based CLI task commands remain compatible.

Search, resume, directory expansion, verification, batch destination naming, concurrency, and queue ordering use the TypeScript implementation. The CLI retains its command syntax and terminal renderer. The default core renderer is silent; progress is available as structured data and persisted task snapshots.

The task store remains `~/.visuales-cli-cache/download/tasks.json`. Read-modify-write operations hold a cross-process lock. Desktop requests expose start, list, resume, cancel, and delete; the UI polls snapshots and refreshes on task-change notifications. Closing the desktop stops its workers and keeps incomplete files for resume. Existing detached CLI processes are not desktop-owned.

## Packaging and Validation

Build the Node sidecar independently of the UI, then copy it and a target-specific Node runtime into Tauri resources and external binaries. Native CI jobs must build and test each supported OS/architecture. Verify the packaged script outside the repository so missing runtime dependencies cannot be hidden by local node_modules.

Keep the Node downloader regression suite. Add protocol, cached search, truncated-download repair, concurrent task updates, cancellation/resume, queue, and process-disconnect integration tests. Verify a macOS application bundle locally; Windows and Linux execution require their own hosts.

## Android

Deferred. Reusing Node on desktop does not imply the core can execute in an Android WebView. Decide between an embedded runtime and platform adapters before starting mobile work.
