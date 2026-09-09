---
status: complete
priority: p3
issue_id: "005"
tags: [desktop, settings, downloads]
dependencies: []
---

# Desktop Settings Page

## Problem Statement

Provide a Settings page for configuring persistent download defaults instead of choosing them for each transfer.

## Findings

- Requested defaults: output folder, maximum connections, maximum concurrency, and maximum retries.
- Desktop and CLI already share the Node core and transfer state; settings should preserve that architecture.
- Promoted from the Later bucket on 2026-09-09. User chose desktop-only defaults; CLI defaults remain unchanged.
- The first Settings pass exposed the engine's single-connection workaround. User subsequently requested a working shared parallel engine; connections are now configurable from one to eight.

## Proposed Solutions

Add a desktop Settings page backed by validated, persistent configuration consumed by the shared Node engine. Reuse existing download options where available.

### Scope Decisions

- Concurrency means simultaneous files within a transfer (1-32); retries are per file (0-20).
- Connections are a per-file maximum (1-8). Files without reliable range metadata, small files, and legacy contiguous partials use one connection.
- New desktop tasks use saved defaults. An explicit destination takes precedence; CLI defaults and flags are unchanged.
- Queued tasks capture options at creation. Running and resumed tasks retain their original options and destination.
- No additional defaults beyond the requested fields are included.

## Recommended Action

Implemented locally and verified. Automatic update UX (007) remains a separate follow-up; its Settings dependency is now satisfied.

## Acceptance Criteria

- [x] Settings exposes output folder, concurrent files, retries per file, and adjustable connections per file with a fallback tooltip.
- [x] Values are validated, persist across restarts, and are used by new downloads according to the agreed precedence.
- [x] Changes do not silently reconfigure running transfers; queued and resumed transfer behavior is explicitly defined.
- [x] Additional settings and CLI sharing behavior are triaged before implementation.
- [x] UI follows the existing shadcn components, JetBrains Mono, teal primary, and 1px corners.

## Work Log

### 2026-09-09: Shared Defaults

Desktop now starts from the CLI's shared core transfer defaults and persists its own overrides. New installations and Restore defaults use five concurrent files, three connections per file, and three retries. Saved values, including an explicit single connection, remain intact. Desktop retains the requested Downloads/Visuales destination; CLI does not read desktop preferences.

### 2026-09-08 - Requested for Later

Recorded the Settings page and requested download defaults. No application behavior changed.

### 2026-09-09 - Implemented Desktop-Only Defaults

Added a compact Settings tab with native folder selection, validated numeric inputs, explicit Save/Discard/Restore defaults, error recovery, and drafts preserved across view switches. Preferences are stored atomically under the shared home directory, outside cache registry entries, so cache clearing preserves them. The Node sidecar consumes defaults; Rust remains a thin transport. Malformed or newer settings files are not silently overwritten.

Verification: npm lint/build and all 84 Node tests pass, including cross-process persistence, concurrent writes, invalid values, cache clearing, explicit overrides, and queued/resumed option preservation. Four Rust tests pass. Browser smoke tests cover save/retry/reload, navigation, restore/discard, and screenshots at 1240x820, 760x620, and 390x844. No release version changed.

### 2026-09-09 - Parallel Engine Follow-Up

Replaced the Node 20+ single-connection limitation with resumable range downloading in the shared core. Each response is checked against negotiated offsets, exact size, encoding, and file version. Failed attempts retain segment progress; unsupported or inconsistent ranges fall back without mixing old bytes. A per-process connection budget protects concurrent files. CLI's default stays three but is now effective; desktop defaults remain independent. The Settings control now persists one through eight connections. Added engine, distributed CLI, process interruption, fallback, retry, connection-budget, and UI coverage.

Final verification: all 111 Node tests and four Rust tests pass, including real four-connection downloads through the distributed CLI and packaged desktop worker. Chrome and WebKit UI checks pass. An aggregate-file test caught and fixed a shared-directory cleanup race; range segments now use independent per-file directories. The live Visuales header probe failed with a connection timeout, so no live throughput result is claimed. Development app rebuilt and launched; installed release and release version unchanged.
