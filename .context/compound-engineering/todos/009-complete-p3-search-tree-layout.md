---
status: complete
priority: p3
issue_id: "009"
tags: [desktop, search, later]
dependencies: []
---

# 2.1: Finder-Style Search Tree

## Problem Statement

Search should show a hierarchical list with collapsible folders and indentation, following the interaction model of macOS Finder's list view.

## Findings

- Requested on 2026-09-10 as a separate bucket item from fetching directory contents.
- The supplied reference shows inline disclosure chevrons, nested folder/file rows, and indentation by depth.
- This is a cross-platform Visuales view, not a requirement to copy Finder's colors, icons, or rounded rows. Preserve Visuales themes, typography, and 1px corners.

## Proposed Solutions

Group existing search results by their paths into an expandable tree list. Expansion in this phase reveals already-known results, not a new remote directory listing. Listing additional folder contents belongs to 2.2 (003).

## Recommended Action

Approved on 2026-09-10. Expand known matching ancestors initially and keep grouping-only ancestors unselectable. Clicking a folder row expands or collapses it; checkboxes select downloads independently. Open folders use the open-folder icon, with no disclosure chevrons. Normalize overlapping folder/child selections into distinct download targets.

## Acceptance Criteria

- [x] Search displays nested folder/file rows with consistent indentation and distinct open/closed folder icons.
- [x] Folders expand and collapse inline without losing the query, results, or selection.
- [x] Tree expansion and download selection are separate actions, with keyboard-accessible navigation.
- [x] Grouping ancestors are distinguished from actual selectable results where necessary.
- [x] Initial tree presentation uses existing search results without fetching directory contents.
- [x] Light/dark themes and supported viewport sizes preserve readable rows and reachable controls.

## Work Log

### 2026-09-10 - Split from Directory Browsing

Recorded the Finder-style tree presentation as bucket item 2.1. Remote listings remain 2.2; cached image/text previews are 2.3. No application code changed.

### 2026-09-10 - Implemented Locally

Added shared tree construction with encoded URL identity, folder-first natural sorting, and duplicate-target filtering. Desktop has indented rows, separate disclosure/selection controls, shift selection, and arrow/Home/End/Space/Enter keyboard interactions. Verified with unit tests and full desktop smoke coverage, including light/dark screenshots at 1240, 760, and 390px. Not released.

### 2026-09-10 - Simplified Folder Controls

User rejected the shared icon/checkbox-slot preview. Removed disclosure chevrons instead: folder rows toggle expansion, checkboxes retain cascading selection, and expanded folders use FolderOpen. File preview behavior and keyboard navigation remain. Folder sizes were explicitly dropped from this change.
