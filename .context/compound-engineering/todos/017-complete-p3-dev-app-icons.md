---
status: complete
priority: p3
issue_id: "017"
tags: [desktop, development, icons]
dependencies: []
---

# Distinguish Development App Icons

## Problem Statement

The development and production apps are difficult to distinguish when both are open.

## Findings

- User requested a `<>` marker on the development application's logo and menu bar icons.
- Production uses one SVG master plus Tauri-generated PNG/ICO/ICNS assets; macOS derives a template tray icon from the master.

## Proposed Solutions

Use dev-only icon variants with a legible `<>` marker for the app/Dock icon, in-app logo, and menu bar/tray icon. Keep production assets unchanged.

## Recommended Action

Implemented dev-only variants generated from the existing master and Lucide Code glyph. Standard native dev scripts apply an icon-only Tauri config overlay; frontend development mode selects the marked logos. Production entrypoints and assets remain unchanged.

## Acceptance Criteria

- [x] The dev application's logo and app icon include a recognizable `<>` marker.
- [x] The dev menu bar/tray icon includes a legible `<>` marker at native display sizes.
- [x] Dev and production instances are visually distinguishable when running together.
- [x] Production builds retain their existing icons without the dev marker.

## Work Log

- 2026-09-17: Added to the bucket at the user's request. No implementation or release requested.
- 2026-09-18: Implemented the native dev icon overlay, marked header/About/popup/favicon, and a wide macOS template tray marker. Dev/production browser checks and 16/24/32/64/128px visual comparisons passed. Native macOS fixture passed while the installed production app stayed open; its transfers were not touched. Two asset/config regressions, 19 Rust tests, and the production frontend build passed. Windows/Linux artwork is generated and covered by shared checks; live native QA on those OSes remains pending. No release requested.
- Final verification: the full desktop browser smoke suite and lint passed. Production master and native icon files have no changes.
- 2026-09-18: Refined the artwork after visual feedback. Removed the dark badge, centered the V, and tucked slim brackets around it. App and tray now share one integrated mark; the macOS template narrowed from 80 to 54 pixels at the same height. Regenerated all development assets, inspected 16/24/32/64/128px previews and light/dark menu-bar sizes, and verified dev/production rendering, two asset tests, 19 Rust tests, native tray smoke, lint, and formatting. The running dev app refreshed; production assets remain unchanged. Not released.
