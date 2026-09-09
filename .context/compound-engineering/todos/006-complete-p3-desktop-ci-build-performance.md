---
status: complete
priority: p3
issue_id: "006"
tags: [desktop, ci, performance, caching, later]
dependencies: []
---

# Desktop CI Build Performance

## Problem Statement

Reduce desktop CI and release build times. During the first 2.0.0 run, the user reported a macOS build taking about seven minutes while other platforms were still running. Originally requested for Later; implementation approved on 2026-09-09.

## Findings

Baseline findings, before implementation:

- `.github/workflows/desktop-release.yml` uses `swatinem/rust-cache@v2` with the root Cargo workspace and `target` directory.
- `.github/workflows/desktop.yml` has no explicit Rust build cache.
- Both workflows set `package-manager-cache: false` and run `npm ci` without an explicit npm cache.
- A release push to `main` triggers both Desktop validation builds and Publish's desktop release matrix, duplicating some compilation and tests.
- The first release may incur cold-cache costs. Actual hit/miss logs and per-step timings have not been checked; do not assume caching alone explains the delay.

## Proposed Solutions

- Measure cold and warm runs per OS/architecture, including dependency installation, tests, Rust compilation, signing, and packaging.
- Add consistent Rust dependency caching to validation builds and evaluate release cache reuse across compatible jobs. Keep keys separated by OS, architecture, toolchain, dependency lockfile, and relevant build settings.
- Enable npm download caching keyed to the workspace lockfile while retaining reproducible `npm ci` installs.
- Evaluate redundant builds and repeated sidecar preparation before considering compiler caching or larger runners. Preserve platform tests and signed release verification.

## Recommended Action

Approved on 2026-09-09. Add shared dependency caching and remove redundant preparation, then measure build-only cold/warm runs. Keep release gates intact. See [CI performance](../../../docs/ci-performance.md) for baseline and cache boundaries.

## Acceptance Criteria

- [x] Record baseline cold/warm timings and cache hits for all supported desktop targets.
- [x] Verify cache invalidation for dependency, Rust toolchain, architecture, and build-setting changes.
- [x] Measure improvement on a subsequent run; do not promise a target before establishing a baseline.
- [x] Retain tests, signature verification, and the all-platform release publication gate.
- [x] Never cache signing credentials or treat cached signed installers as freshly verified release output.
- [x] Document remaining bottlenecks and any deliberately retained duplicate work.

## Work Log

### 2026-09-09 - Implementation and Measurement

Confirmed exact release cache hits on all four platforms; regular desktop validation had no Rust cache. Added shared Rust/npm caching, eliminated redundant sidecar builds, and limited cancellation to superseded validation runs.

Both signed build-only rehearsals passed on all four targets, including updater manifest assembly. Exact Rust/npm hits on the second run reduced combined build-job time from 58m16s cold to 31m30s warm. This is a cold/warm comparison, not an improvement over already-cached previous releases. Regular PR platform/UI validation and local lint/111 Node tests passed. Audited cache key construction, dependency-only cleanup, and preserved publication gates; full results and remaining bottlenecks are in the performance document. No app version or public release changed.

### 2026-09-08 - Requested for Later

Recorded the user's approximately seven-minute macOS build observation and inspected the two desktop workflow cache configurations. No CI behavior changed.
