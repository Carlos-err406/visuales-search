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

Download a directory:

```bash
visuales download "http://visuales.uclv.cu/Series/Ingles/Supernatural/S05/" -o supernatural_5
```

Always quote visuales URLs. They often contain spaces, parentheses, and other shell-sensitive characters.

Download a season while skipping artwork, metadata, and text files:

```bash
visuales download "http://visuales.uclv.cu/Series/Ingles/Supernatural/S06/" \
  --exclude "*.{nfo,jpg,png,txt}" \
  -o ../supernatural_6
```

Useful download options:

- `--output, -o`: output directory.
- `--concurrent, -c`: maximum number of files to download at once. Default: `5`.
- `--connections`: parallel connections per large file. Default: `3`.
- `--exclude`: skip files by glob. Can be repeated or comma-separated.
- `--ignore`: alias for `--exclude`.
- `--resume, -r`: resume interrupted downloads. Default: `true`.
- `--max-retries`: maximum retry attempts. Default: `3`.
- `--timeout`: request timeout in seconds. Default: `Infinity`.

Downloaded file parts are staged in a hidden `.visuales-parts/` sidecar directory and moved into the target folder when assembly finishes.

The downloader supports both legacy table-style Apache listings and the newer preformatted Apache listings currently returned by `visuales.uclv.cu`.

## Cache

Cached data lives in `~/.visuales-cli-cache`.

```bash
visuales cache
visuales cache clear --id discovery
visuales cache clear --all
```

The discovery cache stores directory listings so repeated recursive downloads do not need to rediscover every folder.

## Updating

For npm installs:

```bash
visuales update
```

This reinstalls the latest published npm package globally. If npm reports a permissions error, either run the install with elevated permissions or configure npm to use a user-writable global prefix.

For Homebrew installs:

```bash
brew update
brew upgrade visuales
```

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

The npm package is published from GitHub Actions when a GitHub Release is published.

One-time setup:

1. Create an npm automation token with publish access.
2. Add it to the GitHub repository secrets as `NPM_TOKEN`.

For each npm release:

```bash
npm run release:check
npm run release:patch
git push --follow-tags
```

Use `release:minor` or `release:major` instead of `release:patch` when appropriate. Then create and publish a GitHub Release for the pushed tag. The publish workflow validates the package, builds `dist/`, verifies package contents, and publishes to npm with provenance.

Manual npm publishing is still possible when needed:

```bash
npm run release:check
npm publish
```

After publishing a new npm version, update the Homebrew formula in [docs/homebrew.md](docs/homebrew.md).
