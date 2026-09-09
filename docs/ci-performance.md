# CI Performance

## Baseline

Measured on 2026-09-09. Times are job duration, including setup and cleanup, not queue time.
Hosted-runner load varies, so these are observations rather than performance guarantees.

| Target              | Desktop validation, no Rust cache | v2.0.4 release, exact Rust cache hit | Release cache restore |
| ------------------- | --------------------------------- | ------------------------------------ | --------------------- |
| macOS Apple Silicon | 6m13s                             | 4m34s                                | 18s                   |
| macOS Intel         | 12m06s                            | 10m15s                               | 68s                   |
| Windows x64         | 14m21s                            | 6m49s                                | 29s                   |
| Linux x64           | 8m13s                             | 7m04s                                | 21s                   |

Sources: [Desktop validation](https://github.com/Carlos-err406/visuales-search/actions/runs/34374646850),
[v2.0.4 release](https://github.com/Carlos-err406/visuales-search/actions/runs/34374887206).
These workflows package different formats, so comparing their totals is not a controlled cache benchmark.

All four release cache restores were exact hits. The problem was not a broken release cache:
validation had no Rust cache, and both workflows rebuilt the Node sidecar unnecessarily.

## Changes

- Desktop validation and release builds share a Rust dependency cache namespace per runner image.
- npm download caching uses the root workspace lockfile; every job still runs `npm ci`.
- Validation runs `npm run check` once, then copies that tested sidecar into the native resources.
- The CI-only Tauri config builds the frontend without rebuilding the already-tested sidecar.
  It must only be used after `npm run check` and `node scripts/prepare-sidecar.mjs` in the same job.
  Normal local Tauri builds retain the full preparation hook.
- Package validation inspects the freshly built npm package without repeating the prepack build.
  Normal npm publication hooks are unchanged.
- New commits cancel superseded validation runs for the same PR or branch. Release jobs are never
  cancelled by this policy.

## Cache Boundaries

The explicit shared key includes the runner image (`macos-15`, `macos-15-intel`, `windows-latest`,
or `ubuntu-22.04`). Rust-cache also hashes compiler identity/host, Cargo manifests and lockfile,
toolchain/config files, and build-related environment variables. A changed key can restore a
compatible dependency fallback; Cargo still validates fingerprints and recompiles as needed.
The caches do not replace builds, tests, or signature checks.

The new namespace intentionally starts cold. PR caches are scoped by GitHub to the PR merge ref;
they cannot seed main. Validation and release can reuse compatible main-branch caches after merge.
See [Rust-cache configuration](https://github.com/Swatinem/rust-cache) and
[GitHub cache access restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).

Only npm downloads and Cargo dependencies are cached, not `node_modules`, sidecar output, frontend
output, or signing credentials. Workspace crates are not cached. Rust-cache removes final binaries
and bundle directories when preparing its dependency cache; installers are always freshly built,
signed, and verified. Cargo executable caching is explicitly disabled. See
[Rust-cache cleanup](https://github.com/Swatinem/rust-cache/blob/v2/src/cleanup.ts).

## Deliberately Retained Work

- Debug Rust tests and release compilation remain separate. Sharing dependency caches is the first
  optimization; changing test profiles is deferred until its benefit and coverage tradeoff are measured.
- Every desktop target still runs Node integration tests, Rust bridge tests, and native packaging.
- Updater cryptographic checks, macOS signature/runtime checks, and the all-platform publication gate
  remain intact. The release workflow still defaults to build-only for manual rehearsals.
- PR, main, and release validation can overlap. Avoiding whole workflows needs a reliable release
  classifier; this pass does not risk skipping non-release main validation.
- Linux system packages, installer compression/signing, npm publication hooks, and Homebrew's npm
  propagation wait remain uncached. The v2.0.4 Homebrew CLI job spent 301 seconds waiting for its tarball.
- Small privileged npm publication and Homebrew jobs retain their existing cache policy.

## Follow-Up Measurement

Run Desktop Release on the implementation branch with an empty tag and `publish=false`, then repeat
on the same ref after it finishes. Compare each platform's job duration, Rust cache restore result,
dependency installation, test, and packaging steps. Record both run URLs and note runner variance.
Never dispatch Publish or set `publish=true` for a performance rehearsal.
