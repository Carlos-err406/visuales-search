---
date: 2026-08-19
type: feat
topic: batch-download-targets
---

# Plan: Batch Download Targets As A Synthetic Folder

## Problem

`visuales download` currently accepts one URL or search result id. After `visuales search` returns several useful ids,
users have to run repeated commands manually. The next feature should allow:

```bash
visuales download <id1> <id2> ... <idn>
```

The desired behavior is not "run N independent downloads." It should feel like downloading one folder that contains
the selected items, exactly like the current recursive folder download experience.

## Scope

In scope:

- Accept multiple URLs and/or search aliases in `visuales download`.
- Resolve each id through the existing search alias cache.
- Treat multiple targets as one synthetic top-level folder/job.
- Use one aggregate discovery summary, progress view, and task record.
- Support existing download options: `--output`, `--resume`, `--max-retries`, `--timeout`, `--concurrent`,
  `--connections`, `--compact`, `--detach`, `--exclude`, and `--ignore`.
- Continue downloading other files after individual failures, then fail the overall job at the end if needed.
- Update README examples and command help text.

Out of scope for the first implementation:

- A separate `batch` command namespace.
- A batch-level parallelism setting separate from existing file-level `--concurrent`.
- A redesigned progress UI beyond reusing the recursive directory progress model.
- Adding a full test framework unless implementation reveals a cheap local pattern.

## Current Code Context

- `src/commands/download/index.ts` owns command registration, alias resolution, option parsing, foreground download
  lifecycle, detached process spawning, and hidden task aliases.
- `downloadCommand(url, options)` currently resolves one target, builds one `DownloadOptions` object, starts one task,
  runs `downloadUrl`, and exits on failure.
- `startDetachedDownload(url, options)` already spawns a child CLI process and records that child as a task.
- `buildDownloadArgs(options)` serializes options for child CLI invocations.
- `getDefaultOutputPath(url)` already captures existing single-target output behavior:
  - file URL -> current working directory
  - directory URL -> `cwd/<last-url-segment>`
- `src/lib/cache.ts` exposes `resolveSearchAlias(idOrUrl)`, which returns the cached URL for a search id or the
  original input when no alias exists.
- `src/commands/download/downloader.ts` already has the right model for this feature:
  - `downloadUrl` creates one shared `p-limit(options.concurrent)`
  - directory downloads produce one discovery summary
  - `FileCountProgress` powers one `Overall` bar and active file slots
  - `downloadRecursive` schedules direct files and child directories against the same limit
  - individual file failures are collected while other downloads continue
- `src/commands/download/tasks.ts` task records currently store one `url`; batch resumability needs a compatible
  extension such as `urls?: string[]`.

## Design Decisions

### 1. Use Variadic Command Arguments

Change the public download command from:

```text
download <url>
```

to:

```text
download <targets...>
```

`targets` can be full URLs or search aliases. A single target must keep today's behavior.

### 2. Treat Multiple Targets As A Synthetic Directory

Multiple targets should be normalized into one in-memory download plan that behaves like a directory containing those
targets as top-level children:

- file target -> top-level file in the batch output directory
- directory target -> top-level child directory named from the URL's final path segment
- nested directories inside a directory target -> existing recursive behavior

Rationale: this matches the user’s mental model: selecting several search ids should feel like downloading a folder
that happens to contain those selected items.

### 3. One Batch Task, One Aggregate Progress View

Foreground multi-target downloads should create one task and one progress view. The UI should look like the current
folder-with-subfolders flow:

- one discovery summary across all selected roots
- one `Overall` bar
- the existing active slot bars
- one success/failure result

This means the core implementation belongs in `src/commands/download/downloader.ts`, not in parent-process orchestration.

### 4. Detached Batch Starts One Detached Batch Task

When `--detach` is used with multiple targets, spawn one detached CLI child carrying all targets. The task record should
represent the whole batch so `visuales tasks`, `status`, `cancel`, and `resume` operate on the batch as one job.

### 5. Output Path Semantics

Single-target behavior remains unchanged.

For multiple targets:

- If `--output` is omitted:
  - the batch parent directory is `cwd`
  - file URLs download into `cwd`
  - directory URLs download into `cwd/<last-url-segment>`
- If `--output <path>` is provided:
  - the batch parent directory is `<path>`
  - file URLs download into `<path>`
  - directory URLs download into `<path>/<last-url-segment>`

Rationale: this is the same shape as a directory download where selected directories are children of the root output.

Collision handling:

- If two resolved directory URLs produce the same top-level output path, append a stable short suffix derived from the
  URL to later duplicates.
- Do not alter existing files/folders just because they already exist; resumability depends on stable target paths.

### 6. Failure Policy

Default behavior should match recursive directory downloads: keep downloading other files when individual files fail,
then fail the overall job at the end with a summarized error:

```text
Failed downloads:
  <relative-path>: <reason>
```

The process exits with `1` when any selected root or nested file fails.

### 7. Interrupt Policy

Interrupt behavior should match current single-download behavior: mark the one batch task interrupted, preserve parts,
and print one resume command.

## Implementation Units

### Unit 1: Factor Target Resolution

File: `src/commands/download/index.ts`

- Introduce a `DownloadCommandOptions` interface for the current action options.
- Add `resolveDownloadTarget(input)` to centralize:
  - alias resolution
  - "Resolved id to URL" message
- Keep `DownloadOptions` construction separate so single-target and batch output semantics stay explicit.
- Keep `downloadCommand` exported for `resumeCommand`.

Verification:

- `visuales download <url>` still uses the same default output path and task behavior.
- `visuales tasks resume <task>` still works for existing single-target tasks.

### Unit 2: Add Multi-Root Downloader API

File: `src/commands/download/downloader.ts`

Add an exported API such as:

```ts
downloadUrls(targets: DownloadTarget[], options: DownloadOptions, onProgress?: (progress: DownloadProgress) => void)
```

Each `DownloadTarget` should contain:

- `url`
- top-level relative path or output placement metadata
- enough initial listing/size information, after discovery, to build the aggregate summary

Implementation notes:

- Refactor `downloadUrl(url, options)` so existing single-target behavior delegates to the multi-root implementation
  where practical.
- Reuse `FileCountProgress`, active slot bars, and recursive `downloadRecursive`.
- Use one shared `p-limit(options.concurrent)` across all selected roots.
- Include top-level target names in relative paths so failure output and progress samples are understandable.

Verification:

- A single directory download still behaves exactly as before.
- Multiple directory ids produce one aggregate file count and active slot set.
- Files from different selected directories share the same `--concurrent` pool.

### Unit 3: Wire CLI Batch Mode

File: `src/commands/download/index.ts`

- Change command registration to `.argument("<targets...>", "URLs or search result ids to download")`.
- Make `downloadCommand` accept `string | string[]`.
- Route one target to the single-target flow.
- Route multiple targets to the multi-root downloader API.
- Build one task for the whole batch.
- For detached mode, spawn one child CLI process with all original targets or all resolved URLs.

Verification:

- `visuales download id1 id2` creates one task and one aggregate progress view.
- `visuales tasks status <batch-task>` shows aggregate progress.
- One failed nested file does not prevent later files from running.
- Process exits `1` if any file/root failed.
- Process exits `0` if all files succeeded.

### Unit 4: Batch Task Persistence

Files:

- `src/commands/download/tasks.ts`
- `src/commands/download/index.ts`

- Extend `DownloadTaskRecord` with optional batch target storage, for example `urls?: string[]`.
- Generate batch task ids from all resolved URLs plus output path and relevant options.
- Preserve compatibility with existing one-URL task records.
- Update `resumeCommand` to call the multi-target path when a task has batch targets.
- Keep `cancelCommand` unchanged if a batch task is still just one process id.

Verification:

- Existing task records load normally.
- New batch task records resume all original targets.
- Batch status shows aggregate progress saved through the existing `overallProgress` field.

### Unit 5: Output Path Resolver

File: `src/commands/download/index.ts`

- Extend `getDefaultOutputPath(url, basePath = process.cwd())`.
- Add `getBatchTargetPlacement(url, batchBasePath, usedPaths)`.
- Directory targets use the last URL segment under the batch base path.
- File targets use the batch base path.
- Later duplicate directory output paths get a stable short suffix.

Verification:

- Single file URL with no `--output` still targets `cwd`.
- Single directory URL with no `--output` still targets `cwd/<dir>`.
- Batch directory URLs with `--output downloads` target `downloads/<dir>`.
- Batch file URLs with `--output downloads` target `downloads`.

### Unit 6: Child Argument Serialization For Detached Batch

File: `src/commands/download/index.ts`

- Reuse `buildGlobalArgs(options)` and `buildDownloadArgs(options)`.
- Allow `startDetachedDownload` to receive multiple targets.
- Preserve repeated `--exclude` args.
- Ensure `--verbose` reaches the child command.

Verification:

- `visuales download id1 id2 --detach` starts one detached task.
- `visuales tasks` shows one running batch task.
- `visuales tasks resume <batch-task>` resumes both ids.

### Unit 7: Docs and Help

Files:

- `README.md`
- `src/commands/search/index.ts`
- `src/commands/download/index.ts`

Updates:

- Search output hint becomes `visuales download <id> [id...]`.
- README includes a batch example after the search/download-id flow.
- Download usage says `<url-or-id...>`.
- `--output` help clarifies parent-directory behavior for multiple targets.

Verification:

- `visuales download --help` clearly communicates multi-target usage.

## Test and Verification Plan

No test framework currently exists in the repo, so verification should start with command-level checks and build checks:

- `npm run lint`
- `npm run build`
- `node dist/cli.js download --help`
- `node dist/cli.js search <known term>` to generate aliases, if network/VPN is available
- `node dist/cli.js download <id1> <id2> --detach` with real aliases, then `node dist/cli.js tasks`
- `node dist/cli.js download <url1> <url2> --output /tmp/visuales-batch-test --compact` with small known URLs, if
  the server is reachable

If real network testing is slow or unavailable, verify parser and orchestration behavior with invalid URLs:

- Multiple bad targets should produce one failed job, not N detached-looking failures.
- A single bad target should still behave like current single-download error handling.

## Risks

- Extending task records for batch resumability must preserve old task JSON compatibility.
- Top-level directory name collisions need stable handling to avoid overwriting selected roots.
- Discovery summary must aggregate multiple roots without double-counting or losing relative paths.
- Multi-target `--output` semantics differ from single-target `--output` for directories. This should be documented
  clearly.
- Search aliases are cache-backed; resolving aliases before spawning detached children makes the batch more robust.

## Open Questions

- Should batch mode eventually get `--parallel-roots <n>`? Recommended answer for v1: no; use existing file-level
  `--concurrent`.
- Should batch mode get `--fail-fast`? Recommended answer for v1: no, continue like recursive directory downloads.
- Should duplicate targets be skipped automatically? Recommended answer for v1: no, only avoid duplicate directory
  output collisions.

## Ready To Implement

This plan is ready to implement once the synthetic-folder behavior is accepted.
