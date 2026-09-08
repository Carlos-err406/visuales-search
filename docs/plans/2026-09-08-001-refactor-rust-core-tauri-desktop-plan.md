---
title: Refactor Visuales Into A Rust Core, Rust CLI, And Tauri Desktop App
type: refactor
status: superseded
date: 2026-09-08
---

# Refactor Visuales Into A Rust Core, Rust CLI, And Tauri Desktop App

Superseded by [Node Core and Desktop Sidecar](2026-09-08-002-node-sidecar-migration.md). The Rust engine was retired in favor of sharing the existing TypeScript implementation.

## Summary

Rebuild the current TypeScript CLI architecture as a native Cargo workspace:

- `packages/core`: shared Rust library for search, cache, tasks, and downloads.
- `apps/cli`: Rust CLI preserving the current `visuales` command surface.
- `apps/desktop`: Tauri 2 + React/Vite desktop app for macOS, Windows, and Linux.

Android is out of scope for this phase. The desktop MVP is search plus downloads.

## Implementation Notes

- Preserve the current cache root, `~/.visuales-cli-cache`, so the CLI and desktop app share state.
- Treat the existing TypeScript implementation and tests as the compatibility reference while the Rust implementation reaches parity.
- Keep terminal formatting in the CLI and desktop interaction in Tauri; reusable behavior belongs in `packages/core`.
- Prioritize direct file download parity first, then recursive directory discovery, verification, queueing, and detached/background task parity.

## Test Plan

- Port parser/search/cache tests into Rust core tests.
- Add Rust integration tests for direct file downloads, resume behavior, task persistence, cancellation, and error records.
- Keep the existing Node tests passing while the legacy CLI remains in the repo.
- Add desktop smoke checks for search, folder selection, task creation, progress rendering, cancel, and delete.

## Assumptions

- The Rust CLI eventually replaces the Node CLI.
- React + Vite is the desktop UI stack.
- Tauri uses the Rust core directly rather than bundling a Node sidecar.
- Full recursive downloader parity is a follow-up implementation slice after the workspace foundation compiles.
