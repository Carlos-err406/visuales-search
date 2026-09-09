---
status: ready
priority: p3
issue_id: "006"
tags: [desktop, ci, performance, caching, later]
dependencies: []
---

# Desktop CI Build Performance

## Problem Statement

Reduce desktop CI and release build times. During the first 2.0.0 run, the user reported a macOS build taking about seven minutes while other platforms were still running. Requested for the Later bucket, not immediate implementation.

## Findings

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

- [ ] Record baseline cold/warm timings and cache hits for all supported desktop targets.
- [ ] Verify cache invalidation for dependency, Rust toolchain, architecture, and build-setting changes.
- [ ] Measure improvement on a subsequent run; do not promise a target before establishing a baseline.
- [ ] Retain tests, signature verification, and the all-platform release publication gate.
- [ ] Never cache signing credentials or treat cached signed installers as freshly verified release output.
- [ ] Document remaining bottlenecks and any deliberately retained duplicate work.

## Work Log

### 2026-09-09 - Implementation and Measurement

Confirmed exact release cache hits on all four platforms; regular desktop validation had no Rust cache. Added shared Rust/npm caching, eliminated redundant sidecar builds, and limited cancellation to superseded validation runs. Cross-platform build-only measurement is in progress; no application release requested.

### 2026-09-08 - Requested for Later

Recorded the user's approximately seven-minute macOS build observation and inspected the two desktop workflow cache configurations. No CI behavior changed.
