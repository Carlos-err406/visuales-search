# File Retries and Download Review

## Scope

- Retry one or all recorded failed files on the original stopped task, in core, CLI, and desktop.
- Preserve other file records, destinations, and aggregate progress. Reject concurrent task writers.
- Optional review lists included files and ignored files/subtrees using the download engine's rules.
- Show exact, approximate, and unknown sizes separately; disk checks are advisory and do not claim existing files are reusable.
- Keep immediate Download and Queue actions. Add Review download to Search context menus and the selection footer.
- Release approved as v3.5.0 after implementation and verification.

## Verification

- Isolated HTTP fixtures for retry selection, history, aggregate accounting, partial failures, and ownership.
- Review fixtures for ignore negation, nested paths, explicit files, unknown sizes, and unavailable capacity.
- CLI and sidecar parity tests; desktop interaction smoke tests and responsive screenshots.
- Lint, core/sidecar tests, desktop build, and Rust checks.

## Results

- `npm run check`: 181 tests passed, including core retry/review, distributed CLI, and packaged sidecar coverage.
- `npm run rust:test`: 13 tests passed.
- `npm run lint` and the desktop production build passed. Vite retains its existing large-chunk advisory.
- Focused desktop smoke tests passed for individual/all-failed retries, review failures, queueing, and keyboard dismissal.
- The full desktop UI smoke suite passed against the running dev server.
- Review screenshots verified at 1240px, 900px, and 390px, with geometry assertions preventing clipped or sideways file lists.
- All transfer fixtures were isolated; verification did not start downloads against the user's library.
- Release CI exposed a Windows `EPERM` during atomic task-store replacement. A bounded backoff now handles transient replacement locks while preserving the old file; permanent failures propagate and temporary writes are removed. All 26 focused lifecycle, ignore-rule, and retry/review tests passed after this fix, including two new fault-injection tests.

## Limits

- File retries require a stopped task and retain its identity, options, destination, and other file records. Ordinary Resume still resumes the whole transfer.
- Review is optional and metadata-only. Ignored directories are listed as entire subtrees without fetching their contents.
- Capacity warnings use full download sizes, distinguish approximate/unknown metadata, and do not guarantee sufficient space.
- Reviewed settings are retained by a single-use ticket for ten minutes.
