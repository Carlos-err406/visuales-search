---
date: 2026-08-19
type: feat
topic: tasks-watch
target_version: next
---

# Plan: `visuales tasks watch [id]`

## Problem

Detached downloads now work well enough that checking progress becomes a repeated workflow. `visuales tasks` gives a
snapshot, and `visuales tasks status <id>` gives one detailed snapshot, but neither stays on screen and refreshes while
the download runs.

Add:

```bash
visuales tasks watch [id]
```

`id` is optional. Without it, watch the current active task set. With it, watch one matching task id or URL.

## Scope

In scope:

- Add `visuales tasks watch [id]`.
- Refresh periodically until interrupted or until watched running tasks reach a terminal state.
- Reuse the existing task status/list renderers where possible.
- Support one-task watch and active-task watch.
- Keep output compact and readable in a normal terminal.
- Document the command in README.

Out of scope for v1:

- Interactive keybindings.
- Terminal alternate-screen UI.
- Log tailing.
- Notifications.
- Persisted watch preferences.

## Current Code Context

- `src/commands/tasks/index.ts` registers `tasks`, `resume`, `cancel`, and `status`.
- `src/commands/download/tasks.ts` owns:
  - task store loading and process-alive normalization
  - `printDownloadTasks`
  - `printDownloadTaskStatus`
  - progress rendering helpers
- `listDownloadTasks()` already sorts newest-first and normalizes dead `running` processes to `interrupted`.
- Plain `visuales tasks` now shows only `running` and `interrupted` by default, oldest-to-newest on screen.

## Design Decisions

### 1. Optional Target Argument

Register:

```text
visuales tasks watch [task]
```

- No argument: watch all actionable tasks (`running` or `interrupted`), matching default `visuales tasks`.
- With argument: watch a specific task id or URL, using existing `findDownloadTask` behavior.

### 2. Refresh Interval

Default to a 2-second refresh interval. Add an option:

```text
--interval <seconds>
```

Clamp to a reasonable minimum such as 1 second to avoid hammering the task file.

### 3. Screen Refresh Strategy

Use simple terminal clearing:

```text
\x1Bc
```

or `console.clear()` if it behaves well enough. Avoid alternate-screen or readline-heavy UI for v1.

Each refresh should show:

- heading with current time
- watched scope
- rendered progress/list content
- footer: `Press Ctrl-C to stop watching.`

### 4. Exit Behavior

- If watching one task:
  - exit once the task is no longer `running`
  - leave the final state visible
  - return exit code `0` unless the task does not exist
- If watching all active tasks:
  - continue while at least one task is `running`
  - if there are interrupted tasks but no running tasks, show them once and exit
  - if there are no active tasks, show the existing empty-state message and exit
- Ctrl-C exits `0` after restoring cursor if needed.

Rationale: watch mode should be useful for a running background download, but it should not trap the user forever on
completed work.

### 5. Rendering API Refactor

The current status/list functions print directly. For watch mode, keep this simple:

- Export `findDownloadTask`, `listDownloadTasks`, and small print helpers as needed.
- Add watch-specific functions in `src/commands/download/tasks.ts` rather than duplicating rendering in
  `src/commands/tasks/index.ts`.
- Avoid a large rendering abstraction unless duplication becomes obvious during implementation.

## Implementation Units

### Unit 1: Watch Loop

Files:

- `src/commands/tasks/index.ts`
- `src/commands/download/tasks.ts`

Add:

- `watchDownloadTasks(idOrUrl?: string, options?: { interval?: number | string })`
- command registration for `tasks watch [task]`
- interval parsing and clamping
- Ctrl-C handling

Verification:

- `visuales tasks watch` runs and refreshes.
- `visuales tasks watch <id>` runs and refreshes one task.
- Ctrl-C exits cleanly.

### Unit 2: Render Watch States

File: `src/commands/download/tasks.ts`

Add watch output that reuses existing snapshot renderers:

- all active tasks
- one task found
- one task missing
- no active tasks
- final terminal task state

Verification:

- Interrupted tasks still show resume command.
- Running tasks still show cancel command.
- Batch tasks still show source count and aggregate progress.

### Unit 3: Docs

File: `README.md`

Add examples:

```bash
visuales tasks watch
visuales tasks watch <task-id-or-url>
```

Mention that watch exits once no watched task is running.

## Test and Verification Plan

- `npm run lint`
- `npm run build`
- `node dist/cli.js tasks watch --help`
- Use an existing interrupted/completed task to verify one-shot display.
- Start a tiny local detached download if practical and verify watch refreshes.
- If real server testing is available, run:

```bash
visuales download "<url>" --detach
visuales tasks watch
```

## Risks

- Clearing the terminal can be jarring if output is too tall; keep the render compact by reusing current summaries.
- If the task file is updated while reading, JSON parsing could fail. Existing load code already falls back to an empty
  store on parse errors, but implementation should avoid making that worse.
- `console.clear()` behavior differs by terminal; prefer the simplest escape sequence that works in common shells.

## Ready To Implement

This plan is ready for the next version.
