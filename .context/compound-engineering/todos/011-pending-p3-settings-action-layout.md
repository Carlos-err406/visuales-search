---
status: pending
priority: p3
issue_id: "011"
tags: [desktop, settings, later]
dependencies: ["005"]
---

# Settings Action Layout

## Problem Statement

The Settings footer takes up space even when nothing has changed. Restore defaults should be a header action, separate from saving or discarding edits.

## Findings

- Requested for the bucket on 2026-09-10, not immediate implementation.
- Show the bottom Discard / Save changes section only while there are unsaved settings changes.
- Move Restore defaults to the right side of the Settings header.
- Appearance currently persists immediately; it should not create a false unsaved state.

## Proposed Solutions

Use the existing settings dirty state to conditionally render the save/discard footer. Place Restore defaults in the Settings heading row with responsive alignment. Preserve current save, discard, and reset semantics.

## Recommended Action

Keep deferred in the desktop roadmap. No settings behavior changes are part of the current Search selection fix.

## Acceptance Criteria

- [ ] Clean Settings has no bottom Discard / Save changes section.
- [ ] Editing a saved default shows the footer; saving or discarding removes it when clean.
- [ ] Restore defaults is right-aligned in the Settings header.
- [ ] Restoring defaults uses the same dirty-state rules and does not bypass the save workflow.
- [ ] Header and footer remain usable at narrow and default window sizes.

## Work Log

### 2026-09-10 - Added to Later

Captured the user's Settings layout request separately from cascading Search checkbox selection.
