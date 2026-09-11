---
status: complete
priority: p3
issue_id: "014"
tags: [desktop, settings, downloads]
dependencies: []
---

# Download Exclusions in Settings

## Problem Statement

Expose the CLI's download exclusion option in desktop Settings so users can save patterns for files they do not want downloaded.

## Findings

- User approved implementation of bucket item 4 on 2026-09-11.
- CLI `--ignore <patterns...>` accepts ordered gitignore-style rules. The redundant `--exclude` flag has been removed. Legacy comma/brace shorthand remains supported.
- CLI rules feed the shared engine's `exclude` array. Matching remains in the Node core rather than being reimplemented in the UI or Rust host.
- Desktop transfer settings already persist defaults independently of CLI defaults.

## Proposed Solutions

- Implemented a shadcn multiline pattern editor in Settings > Transfers, using the existing explicit Save/Discard/Restore defaults behavior.
- Saved patterns pass to the shared engine for new downloads and queued tasks. Existing and resumed tasks retain their recorded options.

## Recommended Action

Implemented locally; not yet released. Matching remains in the shared CLI engine. Explicitly selected files retain the CLI's existing precedence over exclusions.

## Acceptance Criteria

- [x] Users can add, edit, remove, and persist multiple default exclusion patterns in desktop Settings.
- [x] Matching is equivalent to CLI `--ignore`, including supported glob syntax.
- [x] New desktop downloads and queued tasks receive the saved exclusions through the shared core.
- [x] Existing and resumed tasks retain their recorded options; CLI defaults remain unchanged.
- [x] Save, Discard, and Restore defaults handle exclusions consistently with other transfer settings.
- [x] An empty pattern list imposes no exclusions.

## Work Log

### 2026-09-10

- Added as deferred desktop bucket item 4 at the user's request.
- Confirmed CLI option names and shared-engine mapping. No application or release changes made.

### 2026-09-11

- Added the persistent multiline editor with shared normalization, bounded validation, deduplication, and brace-aware comma parsing. Legacy preferences load with no exclusions and retain their existing settings.
- Preserved atomic persistence and task-option snapshots. Queued and resumed tasks retain their original patterns even after defaults change; CLI defaults are unchanged.
- Added real local-server download tests for excluded files, nested paths, immediate/queued transfers, and explicit-file precedence. All 137 core/sidecar tests pass.
- Added UI coverage for editing, validation, failed saves, reload persistence, Discard, Restore defaults, and light/dark responsive layouts.

### 2026-09-11: Ordered Ignore Rules

- User requested gitignore-like rules and repeated CLI flags such as `--ignore '*.jpg' --ignore '!poster.jpg'`.
- Replaced the shared any-match glob implementation with node-ignore, retaining brace/comma shorthand via bounded brace expansion. Rules now support ordered negation, comments, rooted paths, directory-only patterns, and escapes.
- Removed deduplication: repeated rules are meaningful after an exception. Desktop preserves order, comments, and significant whitespace through save/reload; its field is now named Ignore rules.
- CLI collects both aliases in actual argument order. Discovery and transfers evaluate each file once relative to its selected folder; ignored directories are pruned. Explicit file targets retain precedence.
- Added matcher and real distributed-CLI tests, expanded queued sidecar tests with nested exceptions, and updated desktop persistence/UI coverage. No release requested.
- Verification: all 143 core/CLI/sidecar tests, desktop UI smoke checks, and the desktop production build pass. Light/dark screenshots retain the full-width editor on narrow windows.

### 2026-09-11: Remove Redundant CLI Alias

- Removed `--exclude` from the accepted flags and CLI help. Commander now collects only `--ignore`, without a separate alias-order accumulator.
- Detached workers emit `--ignore`; resumes explicitly map the persisted `exclude` array into CLI ignore options. Existing task/preferences storage remains compatible.
- Updated current documentation and added coverage for the removed flag, ordered repeated rules, and task compatibility. Historical decision entries retain their original context.
