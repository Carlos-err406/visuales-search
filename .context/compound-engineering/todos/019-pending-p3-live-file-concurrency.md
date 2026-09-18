---
status: pending
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
- This is a deferred request; the scheduler and worker communication changes have not been investigated yet.

## Proposed Solutions

Add runtime concurrency adjustment to the shared-core file scheduler and propagate applied Settings changes to active desktop download workers. Preserve active transfers, progress, and queued-task ordering. Confirm persistence and CLI control scope during planning.

## Recommended Action

Pending triage. Investigate shared-core scheduling and worker configuration updates before implementation. Do not implement scheduling behavior independently in the desktop UI.

## Acceptance Criteria

- [ ] Applied concurrent-file setting changes reach active downloads without restarting them.
- [ ] Decreasing five to three leaves all five active files uninterrupted and launches no replacements for the first two completions.
- [ ] Once the active count reaches three, the scheduler maintains at most three active files by filling slots only when the count drops below three.
- [ ] Increasing three to five immediately launches up to two pending files, if available.
- [ ] Repeated increases/decreases use the latest applied limit without duplicate starts or lost work.
- [ ] Changes affect file concurrency only; connections per file and task queue order remain unchanged.
- [ ] Shared-core tests cover both directions and fewer pending files than available slots.

## Work Log

- 2026-09-17: Added to the bucket with the user's explicit five-to-three and three-to-five scheduling behavior. No implementation or release requested.
