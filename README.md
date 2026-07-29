# visuales

Search and download content from [visuales.uclv.cu](http://visuales.uclv.cu) from the terminal.

## Requirements

- Node.js 20 or newer
- npm

## Installation

Install from this repository while developing:

```bash
npm install
npm run build
npm install -g .
```

After publishing, install the latest release from npm:

```bash
npm install -g visuales
```

## Search

```bash
visuales search supernatural season 5
```

All search terms must be present in the result.

## Download

Always quote visuales URLs. They often contain spaces, parentheses, and other shell-sensitive characters.

```bash
visuales download "http://visuales.uclv.cu/Series/Ingles/Supernatural/S05/" -o supernatural_5
```

Useful options:

```bash
visuales download "<url>" \
  --output ./downloads \
  --concurrent 5 \
  --connections 3 \
  --exclude "*.{jpg,nfo}"
```

- `--concurrent, -c`: maximum number of files to download at once. Default: `5`.
- `--connections`: parallel connections per large file. Default: `3`.
- `--exclude`: skip files by glob. Can be repeated or comma-separated.
- `--ignore`: alias for `--exclude`.
- `--resume, -r`: resume interrupted downloads. Default: `true`.

Downloaded file parts are staged in a hidden `.visuales-parts/` sidecar directory and moved into the target folder when assembly finishes.

## Cache

Cached data lives in `~/.visuales-cli-cache`.

```bash
visuales cache
visuales cache clear --id discovery
visuales cache clear --all
```

## Update

```bash
visuales update
```

This reinstalls the latest published package globally.

## Development

```bash
npm install
npm run lint
npm run build
npm run check
```

## Publishing

Before publishing:

```bash
npm run check
npm pack --dry-run
npm publish
```

The package publishes the compiled `dist/` output and exposes the `visuales` executable.
