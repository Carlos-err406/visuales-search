---
status: complete
priority: p3
issue_id: "011"
tags: [desktop, settings]
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

Implemented on user request. Keep existing save, discard, reset, and immediate appearance persistence semantics.

## Acceptance Criteria

- [x] Clean Settings has no bottom Discard / Save changes section.
- [x] Editing a saved default shows the footer; saving or discarding removes it when clean.
- [x] Restore defaults is right-aligned in the Settings header.
- [x] Restoring defaults uses the same dirty-state rules and does not bypass the save workflow.
- [x] Header and footer remain usable at narrow and default window sizes.

## Work Log

### 2026-09-10 - Added to Later

Captured the user's Settings layout request separately from cascading Search checkbox selection.

### 2026-09-10 - Implemented

Conditionally render the footer from the existing dirty state and move Restore defaults to the header. Keep the transient Saved confirmation in the header after the footer disappears. Extend browser coverage for clean/edit/revert/save/discard/reset states, immediate theme persistence, and header alignment at 1240px, 760px, and 390px widths. Reviewed desktop and narrow screenshots; no engine or CLI changes. Not released yet.

### 2026-09-10 - Browser Preview Follow-Up

Reproduced permanently disabled Save in the plain Vite browser preview: transfer settings allowed editing despite requiring native storage to save. Make those fields and Restore defaults unavailable in preview, show an explicit read-only status, and prevent the unsavable Save/Discard footer. Appearance remains editable because it persists in the browser. Add regression coverage without the mocked Tauri bridge and launch the native development app for real settings testing.
