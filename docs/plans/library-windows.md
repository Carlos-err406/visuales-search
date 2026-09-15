# Library Windows

Implement detached image/text previews, folder-scoped browser windows, and contextual Search actions without duplicating the engine.

- [x] Native resource-window registry, foreground/background opening, deduplication, navigation and close isolation.
- [x] Shared preview cache fast path, bounded/coalesced fetches and loading phases; safe local-file lookup.
- [x] Shadcn/Base UI context menus respecting selection, scoped refresh and downloaded-file reveal.
- [x] Image zoom/pan/fit/navigation; text find/wrap; preview transfer actions and Show in Search.
- [x] Folder windows reuse the main Search/Downloads/Settings UI, with core-scoped index/search and root files.
- [x] Core, sidecar, browser and native verification; open development app.

Release approved for v3.4.0. Preserve installed-app downloads while testing and publishing.

## Verification

- Built core/CLI/sidecar, then `node --test 'test/**/*.test.mjs'`: 173 passing tests, including resumed-file accounting, legacy text decoding, branch scoping, cache concurrency and local-file containment.
- `npm run lint` and desktop production build: pass.
- `BROWSER_CHANNEL=chrome node scripts/test-desktop.mjs`: complete suite passes, including detached previews, main-UI folder windows, status groups and queue animations.
- `cargo test --workspace`: 13 native unit tests pass.
- Native library-window smoke passed at the original feature baseline. Current recheck cannot acquire focus on the fixture's main window before opening a preview; background-focus verification remains blocked by that precondition. The fixture uses no engine or user transfers.
- Screenshots in `.cache/desktop-ui/`: detached text/image previews and folder browser checked.
- Windows/Linux native behavior needs verification on those platforms; this machine's native checks cover macOS.

Folder search matches the shared parsed index beneath its root plus the root's directory listing; it does not recursively crawl the server. Preview byte limits and expiry remain unchanged. Text previews support UTF-8, BOM-marked UTF-16, and Windows-1252/Latin-1, while rejecting binary control data.

Downloads now replace the status selector with collapsible Downloading, Pending, Needs attention and Finished groups. Completed/skipped files publish actual on-disk bytes to the shared overall progress, and completion events bypass task telemetry throttling. Existing running workers retain their loaded engine until a new run.
