---
status: pending
priority: p3
issue_id: "005"
tags: [desktop, settings, downloads, later]
dependencies: []
---

# Desktop Settings Page

## Problem Statement

Provide a Settings page for configuring persistent download defaults instead of choosing them for each transfer.

## Findings

- Requested defaults: output folder, maximum connections, maximum concurrency, and maximum retries.
- Desktop and CLI already share the Node core and transfer state; settings should preserve that architecture.
- Requested for the Later bucket, not immediate implementation.

## Proposed Solutions

Add a desktop Settings page backed by validated, persistent configuration consumed by the shared Node engine. Reuse existing download options where available.

### Open Questions for Triage

- Define maximum connections versus concurrency precisely: per-host connections, per-file connections, simultaneous files, or simultaneous transfers.
- Decide whether defaults apply to both CLI and desktop, and define precedence for explicit per-command or per-transfer overrides.
- Identify any additional download defaults covered by "etc." before expanding the scope.
- Decide when defaults are captured for queued transfers and how resume preserves existing task settings.

## Recommended Action

Keep deferred. Map requested settings to current core capabilities and resolve their scope and precedence before implementation.

## Acceptance Criteria

- [ ] Settings exposes the default output folder, maximum connections, maximum concurrency, and maximum retries with clearly defined meanings.
- [ ] Values are validated, persist across restarts, and are used by new downloads according to the agreed precedence.
- [ ] Changes do not silently reconfigure running transfers; queued and resumed transfer behavior is explicitly defined.
- [ ] Additional settings and CLI sharing behavior are triaged before implementation.
- [ ] UI follows the existing shadcn components, JetBrains Mono, teal primary, and 1px corners.

## Work Log

### 2026-09-08 - Requested for Later

Recorded the Settings page and requested download defaults. No application behavior changed.
