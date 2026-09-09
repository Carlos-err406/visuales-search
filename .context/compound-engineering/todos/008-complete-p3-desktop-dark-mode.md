---
status: complete
priority: p3
issue_id: "008"
tags: [desktop, appearance, later]
dependencies: []
---

# Desktop Dark Mode

## Problem Statement

The desktop app needs a dark appearance alongside its current light theme.

## Findings

- Requested for the feature bucket on 2026-09-09; subsequently approved for implementation and release.
- Keep the existing teal primary color, JetBrains Mono, restrained font weights, and 1px corners.
- Cover Search, Downloads, Settings, update notices, and shared component overlays consistently.

## Proposed Solutions

Implemented an immediately persisted appearance preference in Settings with System, Light, and Dark choices using the existing theme tokens and component system. System is the default and follows live OS changes. The desktop-only localStorage preference does not change download defaults or CLI state.

### Native Appearance

- Apply the preference before styles load to avoid a light flash.
- Use Tauri's app theme API for native window appearance, passing null for System. Serialize changes so slow native responses cannot restore an outdated choice. Native platform builds validate API integration; browser tests mock native appearance.

## Recommended Action

Include in v2.0.6. CLI rendering and download behavior remain unchanged.

## Acceptance Criteria

- [x] Dark mode covers desktop views, notices, menus, tooltips, and form controls; native dialogs follow the host theme.
- [x] Text, selection, progress, errors, and disabled states remain distinguishable; semantic text colors pass contrast checks.
- [x] Preserve the existing light theme and established visual constraints.
- [x] Implement System, Light, and Dark with persistence and live OS-following behavior.
- [x] Verify both themes and dark views at default, minimum desktop, and narrow viewport sizes.

## Work Log

### 2026-09-09 - Added to Bucket

Recorded the user's dark mode request as deferred work. No application behavior changed.

### 2026-09-09 - Implemented for v2.0.6

Added Appearance settings, a charcoal/teal dark palette, pre-render theme bootstrap, and native theme synchronization. Full desktop UI smoke checks pass, including storage failures, rapid native changes, explicit overrides, OS following, contrast, and responsive screenshots. No core or CLI behavior changed.
