---
status: complete
priority: p3
issue_id: "019"
tags: [core, desktop, downloads, concurrency]
dependencies: []
---

# Apply File Concurrency Changes to Active Downloads

## Problem Statement

Changing the concurrent-file setting should affect active downloads as well as new downloads, without restarting or interrupting files already transferring.

## Findings

- User explicitly requested live changes to file concurrency, not connections per file or the number of queued download tasks.
- Decreasing from five to three must keep the five active files running. The first two completions do not launch replacements; once three remain, subsequent completions may start pending files while respecting the new limit.
- Increasing from three to five must immediately start up to two additional pending files, without waiting for an active file to finish.
- Existing p-limit 7 schedulers support live concurrency updates without canceling active promises.
- Applied desktop Settings changes target this sidecar's running and queued workers only. Other settings and CLI-started workers retain their snapshots. Persist the applied concurrency for resume.

## Proposed Solutions

Add runtime concurrency adjustment to the shared-core file scheduler and propagate applied Settings changes to active desktop download workers. Preserve active transfers, progress, and queued-task ordering. Changes are owner-scoped and persisted for resume; there is no new CLI control.

## Recommended Action

Reuse a single mutable p-limit scheduler across discovery, recursive/batch transfers, and selective retries in each desktop worker. Send acknowledged IPC updates after saving settings, persist only the owned task's concurrency under the task-store lock, and retain failed deliveries for a subsequent Save retry.

## Implementation

- [x] Allow a shared runtime scheduler in core single/batch downloads and file retries.
- [x] Add owner-checked task-option persistence and acknowledged worker controls.
- [x] Propagate saved concurrency to owned workers; preserve other settings and queue ordering.
- [x] Verify real held-open transfers, repeated changes, retries, queued starts, and ownership isolation.
- [x] Run core/sidecar, desktop, native, and regression checks; update the bucket.

## Acceptance Criteria

- [x] Applied concurrent-file setting changes reach active downloads without restarting them.
- [x] Decreasing five to three leaves all five active files uninterrupted and launches no replacements for the first two completions.
- [x] Once the active count reaches three, the scheduler maintains at most three active files by filling slots only when the count drops below three.
- [x] Increasing three to five immediately launches up to two pending files, if available.
- [x] Repeated increases/decreases use the latest applied limit without duplicate starts or lost work.
- [x] Changes affect file concurrency only; connections per file and task queue order remain unchanged.
- [x] Shared-core tests cover both directions and fewer pending files than available slots.

## Verification

- `npm run check`: lint and all 281 core/CLI/sidecar tests passed.
- `npm --prefix apps/desktop run build`: passed; existing bundle-size warning remains.
- `BROWSER_CHANNEL=chrome npm run test:desktop`: full desktop UI suite passed, including the Concurrent files help and existing Settings save flow.
- `npm run sidecar:prepare` and `cargo test --workspace --offline`: passed, 19 native tests.
- Real local HTTP fixtures verify growing, draining, rapid changes, queued starts, batches, recursive folders, selective retries, unchanged payloads, task-option persistence, and other-instance isolation.
- IPC tests cover matching acknowledgements, errors, timeout, exit, disconnected channels, and cleanup. A packaged worker suspended with SIGSTOP confirms a failed Save can retry the same value without restarting; this signal-specific test is skipped on Windows.
- Implemented on `codex/live-file-concurrency`, based on the pushed date-sorting branch. No commit, push, or release requested for this feature.

## Work Log

- 2026-09-17: Added to the bucket with the user's explicit five-to-three and three-to-five scheduling behavior. No implementation or release requested.
- 2026-09-18: User approved implementation. Shared-core scheduling with desktop IPC delivery; no new CLI command, no connection-limit changes, no release.
- 2026-09-18: Implemented and verified. Reused p-limit's mutable scheduler, added owner-checked persisted updates and acknowledged IPC, and documented Save behavior. Refreshed the idle dev app without interrupting the production worker.
