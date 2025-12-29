# AGENTS.md

This file contains guidelines and commands for coding agents working in this repository. It serves as the source of truth for project standards, tools, and technical specifications.

## Project Overview

- **Runtime**: Bun (JavaScript/TypeScript runtime)
- **Language**: TypeScript with strict mode enabled
- **Module System**: ES Modules (`"type": "module"`)
- **Package Manager**: **Bun ONLY** (enforced via `preinstall` script)
- **Purpose**: Unified search and download tool for visuales.uclv.cu content

## Commands

### Development

```bash
# Install dependencies
bun install

# Build the CLI
bun run build

# Format codebase
bun run format

# lint codebase
bun run lint
bun run lint:fix

# Run the main script
bun run src/index.ts

# Run with arguments
bun run src/index.ts <query1> <query2> <query3>...

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
visuales download <url> --output <path> [options]

# Examples
visuales download "https://visuales.uclv.cu/Series/Ingles/Killing%20Eve/libros/" --output ./killing-eve-books --concurrent 5
```

### Download Features & Options

- **Concurrency (`--concurrent, -c`)**: Defaults to **5 parallel downloads**.
- **Resumability (`--resume, -r`)**: Defaults to `true`. Uses HTTP Range headers and smart file-size comparison (`skipSmaller`) to resume partial downloads.
- **Directory Discovery Cache**: Persistently caches directory listings in `.cache/discovery.json` to make repeated scans instant.
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

- **src/commands/**: Dedicated subdirectories for each CLI command (`search`, `download`, `cache`, `update`).
- **src/lib/**: Isolated core logic (download management, cache handling, HTML parsing).

### Caching System

- **Unified Cache**: All cached data resides in `.cache/`.
- **Cache Registry**: `index.json` tracks all cache segments (`list`, `discovery`, `download`).
- **Management**: Use `visuales cache` to list, clear, or inspect cached data.

### Dependencies

- **Bun Built-ins**: Prefer Bun's `fetch` and file I/O where appropriate.
- **Key Libraries**: `node-downloader-helper`, `cheerio`, `p-limit`, `cli-progress`, `commander`.

## File Structure Conventions

```
├── .husky/            # Git hooks (pre-commit automation)
├── .cache/            # Centralized cache (gitignored)
├── dist/             # Compiled JavaScript (npm distribution)
├── src/              # Source TypeScript
│   ├── commands/     # Command implementations
│   └── lib/          # Shared logic and utilities
├── .prettierrc       # Formatting rules (LF, 120 width)
├── eslint.config.js  # Linting rules (Flat config)
├── package.json      # Scripts, dependencies, and lint-staged config
├── AGENTS.md         # This file (Project Source of Truth)
└── tsconfig.json     # TypeScript configuration
```

## Notes for Agents

- This project is strictly **Bun-first**. Do not use `npm` or `yarn` for dependency management.
- Always run `bun run build` after modifying CLI commands to test the distributed version.
- Maintain the unified cache system when adding new persistent data.
- Ensure all new code passes `bun run lint` before committing.
