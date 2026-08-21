# AGENTS.md

This file contains guidelines and commands for coding agents working in this repository. It serves as the source of truth for project standards, tools, and technical specifications.

## Project Overview

- **Runtime**: Node.js (JavaScript/TypeScript runtime)
- **Language**: TypeScript with strict mode enabled
- **Module System**: ES Modules (`"type": "module"`)
- **Package Manager**: npm (recommended) or Bun
- **Purpose**: Unified search and download tool for visuales.uclv.cu content

## Commands

### Development

```bash
# Install dependencies
npm install

# Build the CLI
npm run build

# Format codebase
npm run format

# lint codebase
npm run lint
npm run lint:fix

# run the test suite (builds first; the tests import from dist/)
npm test

# lint + build + test, the way CI runs it
npm run check

# Run the built CLI
node dist/cli.js search <term1> <term2> <term3>...
```

### Global Installation

```bash
# Install globally from current directory
npm i -g .

# Use globally
visuales search <term1> <term2> <term3>...
```

## Download Command

```bash
# Use globally
visuales download "<url>" --output <path> [options]

> [!IMPORTANT]
> **Always wrap URLs in double quotes.**
> visuales.uclv.cu URLs often contain spaces, parentheses `()`, and other special characters that the bash shell will try to interpret, causing syntax errors like `bash: syntax error near unexpected token '('`.

# Examples
visuales download "https://visuales.uclv.cu/Series/Ingles/Killing%20Eve/libros/" --output ./killing-eve-books --concurrent 5
```

### Download Features & Options

- **Concurrency (`--concurrent, -c`)**: Defaults to **5 parallel downloads**.
- **Resumability (`--resume, -r`)**: Defaults to `true`. Uses HTTP Range headers and smart file-size comparison (`skipSmaller`) to resume partial downloads.
- **Directory Discovery Cache**: Persistently caches directory listings in `.cache/discovery.json` to make repeated scans instant.
- **Integrity Verification**: Every finished file is checked _before_ it leaves the `.visuales-parts/` sidecar directory. When the exact size is already known and matches, the file passes with no extra request. Otherwise the server is asked for a single byte at the current end of the file (`Range: bytes=<local-size>-<local-size>`): a `416` proves the file is whole, while a `206` reveals the real total in `Content-Range` and the missing bytes are appended right away. Because it does not depend on `HEAD` or `Content-Length`, a transfer cut short by a flaky connection can no longer be reported as complete. If the server discloses no usable total at all, the file is kept but left unverified rather than wrongly declared complete.
- **Incomplete File Reconciliation**: A partial file already sitting in the output directory is moved back into `.visuales-parts/` and resumed from its current size instead of being downloaded again. Every resumed request carries `If-Range` (ETag/Last-Modified), including the resume of a parts file left behind by an interrupted run, so a file that changed upstream is re-fetched in full rather than appended to. A `206` whose range does not start exactly where the local file ends is refused instead of appended.
- **Robust Error Handling**: Explicitly detects server-side blocks, 503 errors, and redirects to "URL not available" pages.
- **Professional UI**: Multi-bar progress tracking with real-time speed and status ("Resuming...", "Already exists").

## Code Quality & Automation

### Style & Linting

- **Prettier**: Enforced for all files.
  - **Print Width**: 120
  - **Line Endings**: LF (Strict)
- **ESLint**: Flat configuration (`eslint.config.js`) using `typescript-eslint`.
  - Disables conflicting formatting rules via `eslint-config-prettier`.
  - Enforces type safety and clean code (no unused variables/imports).

### Git Hooks

- **Husky & lint-staged**: Automatically runs on `pre-commit`.
  - Formats all staged files.
  - Lints and fixes staged TS/JS files.
  - **Commit Block**: Commits are blocked if lint errors are unfixable.

## Project-Specific Guidelines

### Modular Architecture

- **src/commands/**: Dedicated subdirectories for each CLI command (`search`, `download`, `cache`, `tasks`).
- **src/lib/**: Isolated core logic (download management, cache handling, HTML parsing).

### Caching System

- **Unified Cache**: All cached data resides in `~/.visuales-cli-cache/` (user home directory). This ensures consistency between local dev and global installations.
- **Cache Registry**: `index.json` tracks all cache segments (`list`, `discovery`, `download`).
- **Management**: Use `visuales cache` to list, clear, or inspect cached data.

### Dependencies

- **Key Libraries**: `node-downloader-helper`, `cheerio`, `p-limit`, `cli-progress`, `commander`.

## File Structure Conventions

```
├── .husky/            # Git hooks (pre-commit automation)
├── .cache/            # Centralized cache (gitignored)
├── dist/             # Compiled JavaScript (npm distribution)
├── src/              # Source TypeScript
│   ├── commands/     # Command implementations
│   └── lib/          # Shared logic and utilities
├── test/             # node:test suites (run against dist/, not published)
├── .prettierrc       # Formatting rules (LF, 120 width)
├── eslint.config.js  # Linting rules (Flat config)
├── package.json      # Scripts, dependencies, and lint-staged config
├── AGENTS.md         # This file (Project Source of Truth)
└── tsconfig.json     # TypeScript configuration
```

## Notes for Agents

- This project recommends **npm**.
- Always run `npm run build` after modifying CLI commands to test the distributed version.
- Maintain the unified cache system when adding new persistent data.
- Ensure all new code passes `npm run lint` before committing.
- **CLI Operations Timeout**: When testing CLI commands that interact with `visuales.uclv.cu` (slow Apache server), always use very large timeouts (minimum 60-120 seconds) as the server is extremely slow and may take considerable time to respond.
