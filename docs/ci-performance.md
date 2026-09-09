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
or `ubuntu-22.04`) and the root `Cargo.toml` hash. The root is a virtual workspace, so it is not
included among the package manifests discovered by `cargo metadata`; hashing it explicitly covers
shared dependencies, features, and profile settings. Rust-cache also hashes compiler identity/host, package manifests and lockfile,
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

## Cold/Warm Verification

Both build-only rehearsals used commit `c8a984c` and the same matrix, with no publication:
[cold run](https://github.com/Carlos-err406/visuales-search/actions/runs/34380303180) and
[warm run](https://github.com/Carlos-err406/visuales-search/actions/runs/34381489484).
Every cold Rust restore reported `No cache found`; every warm restore reported an exact match.
All four warm npm restores hit as well. Both complete updater manifests passed validation.

| Target              | Cold job | Warm job | Warm Rust restore | Rust tests, cold / warm | Packaging, cold / warm |
| ------------------- | -------- | -------- | ----------------- | ----------------------- | ---------------------- |
| macOS Apple Silicon | 10m21s   | 4m37s    | 28s               | 124s / 25s              | 301s / 97s             |
| macOS Intel         | 22m26s   | 13m12s   | 76s               | 391s / 61s              | 542s / 295s            |
| Windows x64         | 14m42s   | 6m48s    | 27s               | 199s / 36s              | 407s / 146s            |
| Linux x64           | 10m47s   | 6m53s    | 29s               | 127s / 13s              | 347s / 182s            |

Across the four build jobs this was 58m16s cold versus 31m30s warm, about 46% fewer runner minutes.
This measures cold versus warm behavior of the new configuration, **not** a 46% improvement over
previous releases, which already had working Rust caches. Their warm durations were broadly similar
on three targets; Intel was slower in this sample. Its Node checks took 184s versus the previous
release's 101s, and Linux system-package installation took 88s versus 40s. Runner variability and
uncached work remain significant. The principal improvement is extending caching to regular Desktop
validation and avoiding known repeated preparation, not making release compilation disappear.

The [regular PR validation](https://github.com/Carlos-err406/visuales-search/actions/runs/34380356515)
also passed all four native targets and the UI smoke tests. Its cold Intel job was an outlier at
37m35s; no warm-validation duration is claimed from this run. Package validation passed in 1m16s.
Locally, lint, all 111 Node tests, version consistency, and npm package inspection passed.

Cache invalidation was checked against the action's [key construction](https://github.com/Swatinem/rust-cache/blob/v2/src/config.ts)
and the emitted keys, not by running a separate build for every possible dependency/toolchain change.
Root workspace settings and runner image are explicit inputs; OS/architecture, compiler/environment,
package manifests, dependency lockfile, and Cargo/toolchain config are action-managed inputs.
Signing credentials are only supplied to the signing step, and publication/Homebrew were skipped in
both rehearsals. The initial main-branch run after merge will populate its own new cache namespace.

## Repeating the Measurement

Linux jobs disable only the hosted runner's system Google Chrome APT source (both `.list` and
`.sources` formats) before installing dependencies. A subsequent PR run failed in native and UI
setup because that unused repository returned a `Hash Sum mismatch`. Tauri uses Ubuntu's WebKit
packages and the smoke tests use Playwright's downloaded Chromium, not system Chrome. Ubuntu
repositories, package hash/signature verification, and real installation failures remain intact.
This applies to validation, Playwright dependency installation, and release packaging runners only;
it does not change the user's system or the distributed app.

Run Desktop Release on the implementation branch with an empty tag and `publish=false`, then repeat
on the same ref after it finishes. Compare each platform's job duration, Rust cache restore result,
dependency installation, test, and packaging steps. Record both run URLs and note runner variance.
Never dispatch Publish or set `publish=true` for a performance rehearsal.
