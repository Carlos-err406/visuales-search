# visuales

Search and download content from [visuales.uclv.cu](http://visuales.uclv.cu) from the terminal.

## Requirements

- Node.js 20 or newer
- npm, or Homebrew on macOS/Linux

## Installation

Install with npm:

```bash
npm install -g visuales
```

Or install with Homebrew:

```bash
brew tap Carlos-err406/visuales
brew install visuales
```

Verify the install:

```bash
visuales --version
```

## Usage

Search for content:

```bash
visuales search supernatural season 5
```

All search terms must be present in a result.

Bypass the search cache and refresh it from visuales.uclv.cu:

```bash
visuales search --no-cache supernatural season 5
```

Download a directory:

```bash
visuales download "http://visuales.uclv.cu/Series/Ingles/Supernatural/S05/" -o supernatural_5
```

If `--output` is omitted, directory URLs download into a folder named after the final URL path segment in the current directory. File URLs download into the current directory.

Download multiple search results as one synthetic folder:

```bash
visuales download 7zM4aQ 8B2vcc 9CgNxD -o supernatural-picks
```

For multiple targets, `--output` is the parent folder. File targets download into that folder, and directory targets download into child folders named after their final URL path segment.

Always quote visuales URLs. They often contain spaces, parentheses, and other shell-sensitive characters.

Download a season while skipping artwork, metadata, and text files:

```bash
visuales download "http://visuales.uclv.cu/Series/Ingles/Supernatural/S06/" \
  --exclude "*.{nfo,jpg,png,txt}" \
  -o ../supernatural_6
```

Useful download options:

- `--output, -o`: output directory. Optional; defaults to the current directory for file URLs and a target-named folder for directory URLs. With multiple targets, this is the parent directory.
- `--concurrent, -c`: maximum number of files to download at once. Default: `5`.
- `--connections`: maximum parallel connections per large file, capped at `8`. Default: `3`.
- `--exclude`: skip files by glob. Can be repeated or comma-separated.
- `--ignore`: alias for `--exclude`.
- `--resume, -r`: resume interrupted downloads. Default: `true`.
- `--max-retries`: maximum retry attempts. Default: `3`.
- `--timeout`: request timeout in seconds. Default: `Infinity`.
- `--detach, -d`: start the download in the background and return immediately.

Recursive and multi-target downloads show a whole-job file counter such as `FILES 7/24`, so you can see how many files are complete across the full synthetic directory tree.

Downloaded file parts are staged in a hidden `.visuales-parts/` sidecar directory and moved into the target folder when assembly finishes.

The downloader supports both legacy table-style Apache listings and the newer preformatted Apache listings currently returned by `visuales.uclv.cu`.

List running or interrupted download tasks:

```bash
visuales tasks
```

Watch running download tasks until they finish or become interrupted:

```bash
visuales tasks watch
```

When watch exits, it prints a summary of what happened to the watched tasks.

Clear saved download task history:

```bash
visuales tasks --clear
```

Resume a previous task by id or URL:

```bash
visuales tasks resume <task-id-or-url> [more-task-ids-or-urls...]
```

Show one task:

```bash
visuales tasks status <task-id-or-url> [more-task-ids-or-urls...]
```

Watch one task by id or URL:

```bash
visuales tasks watch <task-id-or-url>
```

Run a download in the background:

```bash
visuales download "http://visuales.uclv.cu/Series/Ingles/Supernatural/S05/" -o supernatural_5 --detach
```

Detached downloads keep updating the task file, so `visuales tasks` shows the running PID, last progress, and log file. Stop a running background download with:

```bash
visuales tasks cancel <task-id-or-url> [more-task-ids-or-urls...]
```

`resume`, `status`, and `cancel` accept multiple task ids or URLs.

Each download stores its source URL, output path, options, and last progress in `~/.visuales-cli-cache/download/tasks.json`.
Interrupted tasks also store why they stopped when the CLI can determine it, such as a user cancellation, interrupt signal, or unexpected process exit.
By default, partial multi-connection chunks are preserved so interrupted downloads can resume. Use `--resume false` to discard existing chunk state and start a download cleanly.

## Cache

Cached data lives in `~/.visuales-cli-cache`.

```bash
visuales cache
visuales cache clear --id discovery
visuales cache clear --all
```

The discovery cache stores directory listings so repeated recursive downloads do not need to rediscover every folder.

## Development

```bash
npm install
npm run check
```

The CLI and desktop use the same Node/TypeScript engine:

- `packages/core`: search, cache, directory discovery, downloads, verification, and task persistence.
- `apps/cli`: terminal commands and progress rendering. The published entry remains `dist/cli.js`.
- `apps/sidecar`: JSON-RPC over stdin/stdout, with an isolated Node worker for each desktop download task.
- `apps/desktop`: React UI and a thin Tauri shell for windows, native dialogs, and sidecar lifecycle.

The desktop bundles Node and the sidecar script; end users do not need Node installed. Rust does not implement search or downloads.

Run the desktop app during development:

```bash
npm run desktop:dev
```

Development requires Node 20.19+ (or 22.12+), Rust, and the platform's Tauri build prerequisites. Use an official Node binary for release builds. Build on each target OS/architecture; cross builds require `VISUALES_NODE_BINARY` pointing to the target's Node executable. A universal macOS build needs a universal Node executable as well.

```bash
npm run desktop:build
```

Desktop builds prepare the runtime and script automatically. `npm run sidecar:prepare` prepares them for direct Cargo builds. The existing `~/.visuales-cli-cache/` layout is shared with the CLI, and task updates use an interprocess lock. Closing the desktop stops its workers and leaves partial files resumable. Detached CLI tasks continue independently.

Android is deferred: Tauri's desktop sidecar mechanism does not provide an Android Node runtime. Mobile requires a separate runtime/storage/background-transfer design.

The desktop opens in Search, with a contextual selection bar and expandable transfer activity. Downloads lists the shared task history. UI priorities and deferred requests are tracked in [Desktop Roadmap](docs/desktop-roadmap.md).

Desktop controls use shadcn/ui's Base UI components in `apps/desktop/src/components/ui`. Add components with `npx shadcn@latest add <component> --cwd apps/desktop`; `components.json` selects the Base Nova style. Tailwind tokens in `src/theme.css` map to the app's teal palette, local JetBrains Mono fonts, and 1px radii. `src/styles.css` owns the workspace layout and compact app-specific styling. Icon buttons share one Base UI tooltip handle and popup, with no custom hover ownership or entrance animations between buttons. Native folder dialogs and all Node-side task behavior remain unchanged.

The desktop destination is a parent folder: selecting `Season/` saves into `<destination>/Season/`, even when it is the only selection. Individual files save directly into the destination. Existing tasks retain their recorded output paths when resumed; the CLI's explicit `--output` behavior is unchanged.

Settings saves desktop-only defaults for the output folder, concurrent files (1-32), connections per file (1-8), and retries per file (0-20). Transfer defaults come from the same core definition as the CLI: five concurrent files, three connections per file, and three retries, with resume enabled and no request timeout. Desktop keeps the OS Downloads folder's `Visuales` subfolder as its default destination. Saved preferences override these defaults without changing the CLI. Save changes commits the form; Discard restores saved values, and Restore defaults stages the shared baseline for review before saving.

Preferences live in `~/.visuales-cli-cache/desktop-settings.json` and survive cache clearing. Each new desktop task captures its defaults at creation; existing, queued, and resumed tasks keep their stored options. An explicitly chosen download destination overrides the saved folder. CLI defaults and flags are unchanged.

The shared Node engine now honors connection counts with parallel HTTP range downloads for files larger than 10 MiB. It probes actual range support and a strong file validator, validates each response's offsets and length, and stores resumable segments inside `.visuales-parts/`. Segments are assembled before the existing verifier promotes the final file. Interrupted segments can resume with a different connection limit; changed remote content invalidates old segments. Files without reliable range metadata fall back to one connection. Legacy contiguous partial files retain single-stream resume.

Up to 16 download requests can run across files in one CLI process or desktop transfer worker; independent processes have separate limits. Retries use the existing per-file budget, including HTTP 429/5xx responses. This restores the previously bypassed CLI `--connections` behavior on Node 20+, without changing its default of three or making desktop preferences apply to the CLI.

To run the isolated browser smoke checks, start Vite with `npm run dev -w visuales-desktop`, then run `node test/desktop-ui.smoke.mjs` with Playwright and its Chromium browser available. Set `PLAYWRIGHT_MODULE` to an external Playwright module path if it is not installed in this workspace; `BROWSER_CHANNEL=chrome` uses installed Chrome instead. `DESKTOP_URL` overrides the default `http://127.0.0.1:1420/`. These checks use an in-memory Tauri bridge, never real downloads or your task store, and save screenshots under `.cache/desktop-ui/`.

Useful scripts:

- `npm run lint`: run ESLint.
- `npm run build`: build the shared core and distributable CLI into `dist/`.
- `npm run sidecar:build`: typecheck and bundle the Node engine for desktop.
- `npm run rust:build`: prepare the sidecar and build the Tauri backend.
- `npm run rust:test`: prepare the sidecar and run Rust bridge tests.
- `npm run desktop:dev`: launch the Tauri desktop app in development.
- `npm run release:check`: run checks and verify package contents with `npm pack --dry-run`.

Install the local checkout globally while developing:

```bash
npm install
npm run build
npm install -g .
```

## Publishing

Starting with 2.0.0, macOS desktop releases are also available through the existing Homebrew tap:

```sh
brew install --cask Carlos-err406/visuales/visuales-desktop
```

This installs `Visuales.app` for Apple Silicon or Intel (macOS 13.5+). The `visuales` formula remains the CLI; both can be installed together. Desktop releases automatically update the cask after installers are published.

### First Launch on macOS

Visuales uses ad-hoc signing and is not notarized by Apple. macOS may block the first launch. If you trust the release you installed:

1. Try opening Visuales once.
2. Open **System Settings > Privacy & Security** and find the Visuales warning.
3. Click **Open Anyway**, then confirm **Open** (authenticate if prompted).

This approves Visuales specifically; do not disable Gatekeeper globally. Managed Macs may not permit this exception. See [Apple's instructions](https://support.apple.com/en-us/102445).

### Release Automation

The CLI and desktop share one release version. GitHub Actions publishes when `package.json` changes on `main`; desktop installers and signed in-app updates join the same release. See [Desktop Releases and Updates](docs/desktop-releases.md) for signing setup, build rehearsals, and recovery.

One-time setup:

1. Configure npm trusted publishing for this repository's `publish.yml` workflow (already used by the existing CLI pipeline).
2. Configure the dedicated Visuales updater key and GitHub secrets described in the desktop release guide.
3. Create a GitHub token with write access to `Carlos-err406/homebrew-visuales`.
4. Add it to the GitHub repository secrets as `HOMEBREW_TAP_TOKEN`.

For each npm release:

```bash
npm run release:check
npm run release:patch
git push origin main
```

Use `release:minor` or `release:major` instead of `release:patch` when appropriate. The version hook synchronizes workspace, Tauri, and Rust versions. The publish workflow creates the matching `vX.Y.Z` tag and a draft GitHub Release, publishes npm, and updates Homebrew. Desktop CI builds and verifies signed artifacts for both macOS architectures, Windows, and Linux; only then does one final job publish the complete release and updater manifest.

Manual npm publishing is still possible when needed:

```bash
npm run release:check
npm publish
```

The Homebrew tap update is automatic in GitHub Actions. See [docs/homebrew.md](docs/homebrew.md) for the manual fallback.
