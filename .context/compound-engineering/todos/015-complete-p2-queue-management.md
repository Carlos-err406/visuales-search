---
status: complete
priority: p2
issue_id: "015"
tags: [core, cli, desktop, queue]
dependencies: []
---

## Problem Statement

Users need to reorder waiting downloads and choose which starts next across CLI and desktop.

## Findings

The shared task store is locked, but queue readiness and claiming are separate operations. Reordering must not let multiple workers pass the gate.

## Proposed Solutions

Persist ordering separately from enqueue timestamps. Move and claim under the existing store lock. Retain FIFO for untouched queues and legacy records.

## Recommended Action

Implement shared move/next operations, CLI queue inspection and positional moves, and compact desktop queued-row controls. Start next promotes without interrupting running work. No release requested.

## Acceptance Criteria

- [x] Persistent shared order; new/requeued tasks append, worker registration preserves order.
- [x] Atomic claim and reorder; validate missing/nonqueued tasks, ownership, and positions.
- [x] CLI queue, move, and next commands with visible positions and nonzero errors.
- [x] Desktop queued filter, positions, next/up/down controls, pending/error states.
- [x] Core, CLI, sidecar, and desktop regression coverage; visual check at narrow/default widths.

## Work Log

- 2026-09-14: User approved queue management across core, CLI, and desktop. Inspected shared task locking, worker startup, and existing UI controls.
- 2026-09-14: Implemented shared ordering and atomic claims, CLI commands, sidecar/native adapters, desktop controls, and matching tray order. Full Node suite passed (160 tests), followed by six focused queue tests including an additional duplicate-claim case. All 13 native tests and the desktop browser suite passed; production frontend and native debug builds succeeded. Screenshots inspected at 1240px and 390px; layout also checked at 760px. No release or app restart performed. Already-running older CLI workers retain their old scheduler until interrupted/requeued with the updated CLI.
