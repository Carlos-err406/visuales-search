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
- `--connections`: parallel connections per large file. Default: `3`.
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

Useful scripts:

- `npm run lint`: run ESLint.
- `npm run build`: compile TypeScript into `dist/`.
- `npm run release:check`: run checks and verify package contents with `npm pack --dry-run`.

Install the local checkout globally while developing:

```bash
npm install
npm run build
npm install -g .
```

## Publishing

The npm package is published from GitHub Actions when `package.json` changes on `main`.

One-time setup:

1. Create an npm automation token with publish access.
2. Add it to the GitHub repository secrets as `NPM_TOKEN`.
3. Create a GitHub token with write access to `Carlos-err406/homebrew-visuales`.
4. Add it to the GitHub repository secrets as `HOMEBREW_TAP_TOKEN`.

For each npm release:

```bash
npm run release:check
npm run release:patch
git push origin main
```

Use `release:minor` or `release:major` instead of `release:patch` when appropriate. The publish workflow detects the package version, creates the matching `vX.Y.Z` tag and GitHub Release when needed, validates the package, builds `dist`, verifies package contents, publishes to npm, and updates the Homebrew tap formula.

Manual npm publishing is still possible when needed:

```bash
npm run release:check
npm publish
```

The Homebrew tap update is automatic in GitHub Actions. See [docs/homebrew.md](docs/homebrew.md) for the manual fallback.
