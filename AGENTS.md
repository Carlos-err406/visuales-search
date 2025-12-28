# AGENTS.md

This file contains guidelines and commands for coding agents working in this repository.

## Project Overview

- **Runtime**: Bun (JavaScript/TypeScript runtime)
- **Language**: TypeScript with strict mode enabled
- **Module System**: ES Modules (`"type": "module"`)
- **Purpose**: Search tool for visuales.uclv.cu content

## Commands

### Development
```bash
# Install dependencies
bun install

# Build the CLI
npm run build

# Run the main script
bun run src/index.ts

# Run with arguments
bun run src/index.ts <query1> <query2> <query3>...

# Run the built CLI
node dist/cli.js search <term1> <term2> <term3>...
```

### Global Installation
```bash
# Install globally from npm registry
npm i -g visuales

# Or install globally from current directory
npm i -g .

# Use globally
visuales search <term1> <term2> <term3>...

# Examples
visuales search "anti flag"
visuales search curso python
visuales search libros pdf
```

### Testing
No tests are currently configured. When adding tests:
- Use `bun test` (Bun's built-in test runner)
- Place test files alongside source files with `.test.ts` suffix
- Or use Vitest: `bun add -d vitest` and `bunx vitest run`

### Type Checking
```bash
# Type check (Bun handles this automatically, but can run tsc directly)
bunx tsc --noEmit
```

## Code Style Guidelines

### TypeScript Configuration
- `strict: true` - All strict type checking enabled
- `noUncheckedIndexedAccess: true` - Array access returns undefined by default
- `noImplicitOverride: true` - Explicit override required
- Target: `ESNext`, Module: `Preserve`

### Imports
- Use ES module imports/exports
- Absolute imports from project root preferred for clarity
- Keep imports organized: external libs → internal modules → types
- Remove unused imports (not flagged currently, but maintain clean code)

### Naming Conventions
- **Variables/Functions**: camelCase
- **Classes**: PascalCase
- **Constants**: UPPER_SNAKE_CASE or camelCase
- **Types/Interfaces**: PascalCase, prefix with `I` for interfaces if distinction needed
- **Files**: PascalCase for types, camelCase for utilities, or kebab-case for components

### Error Handling
- Use try-catch for async operations (fetch, I/O)
- Provide meaningful error messages with context
- Consider adding error codes or types for programmatic handling
- Exit gracefully on fatal errors (process.exit(1))

### Console Output
- Use ansi-colors for colored terminal output
- Group related output with clear section headers
- Use emoji prefixes for better readability (📂, ✅, ❌, etc.)
- Keep user-facing messages concise and helpful

### Code Organization
- Keep functions small and focused (single responsibility)
- Extract constants to top of file or separate config file
- Use type interfaces for complex data structures
- Add JSDoc comments for public APIs and complex logic

### Dependencies
- Prefer Bun built-ins where possible (fetch, file I/O)
- Use Cheerio for HTML parsing
- Use ansi-colors for terminal output
- Install packages with: `bun add <package>`
- Install dev dependencies with: `bun add -d <package>`

## Project-Specific Guidelines

### Modular Architecture

The codebase is organized into focused modules for maintainability:

#### Core Modules
- **types.ts**: All interface definitions and configuration constants
- **cache.ts**: HTML caching functionality with 24-hour expiry
- **html-parser.ts**: HTML parsing and search result extraction using Cheerio
- **tree-builder.ts**: Tree construction logic with directory URL mapping
- **display.ts**: Tree display and formatting with clickable links
- **cli.ts**: Command-line interface and user interaction

#### Main Entry Point
- **index.ts**: Orchestrates all modules and handles application flow

### Search Script (html-parser.ts)
- Fetch HTML from https://visuales.uclv.cu/listado.html
- Parse using Cheerio, extract all `<a>` tags
- **URL decoding**: Decode URLs immediately after extraction (double decode for doubly-encoded URLs)
- Search logic: AND operation - ALL provided terms must match
- Search scope: Both link text AND URL path (case-insensitive)

### Tree Building (tree-builder.ts)
- **Tree structure**: Build nested tree from directory paths using Map-based TreeNode structure
- Results are stored at their leaf node in the tree hierarchy
- **Clickable directories**: All directory levels that have URLs are clickable (cyan) and show URLs directly below
- Directory URLs are collected from all parsed results, then applied to tree nodes
- Intermediate directories become clickable even when they don't match search terms directly
- Tree building uses two-pass approach: parse all directory URLs first, then build filtered tree

### Display (display.ts)
- Unicode tree characters with colored output
- Clickable directories are shown in cyan with hyperlinks
- Non-clickable directories are shown in yellow bold
- URLs appear directly below each clickable directory
- ANSI escape sequences for terminal hyperlinks

### CLI Interface (cli.ts)
- Accept multiple search terms as command-line arguments
- Provide clear usage instructions if no arguments provided
- Show count of matches found
- Display "No results found" message with helpful hints
- Colored output with emoji prefixes for better readability

### Data Structures (types.ts)
- `SearchResult`: Individual search result with url, text, directory, encodedUrl, and isDirectoryLink flag
- `TreeNode`: Hierarchical tree node with name, fullPath, children map, results array, and optional directory link info
- Results are attached to leaf nodes in the tree (deepest matching directory)
- Tree is built from URL path segments and supports arbitrary nesting depth
- Directory URLs are collected from all results and applied to appropriate tree nodes

## File Structure Conventions

```
├── index.ts           # Main entry point - orchestrates all modules
├── types.ts           # Type definitions and interfaces
├── cache.ts           # HTML caching functionality
├── html-parser.ts     # HTML parsing and search result extraction
├── tree-builder.ts    # Tree construction logic
├── display.ts         # Tree display and formatting
├── cli.ts             # CLI interface and user interaction
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── bun.lock           # Dependency lock file
├── AGENTS.md         # This file
├── src/              # Source TypeScript files
│   ├── cli.ts        # Main CLI entry point with shebang
│   ├── index.ts      # Development entry point
│   ├── types.ts      # Type definitions
│   ├── cache.ts      # HTML caching functionality
│   ├── html-parser.ts # HTML parsing and search logic
│   ├── tree-builder.ts # Tree construction logic
│   └── display.ts    # Tree display and formatting
├── dist/             # Compiled JavaScript (included in npm package)
│   ├── cli.js        # Global CLI entry point
│   └── *.js          # Other compiled modules
└── .cache/            # Local cache directory (gitignored)
    └── listado.html.json  # Cached HTML with timestamp
```

## Best Practices

- Run type checking before committing
- Test with various search queries and edge cases
- Handle network errors gracefully
- Consider performance for large HTML pages
- Cache should be invalidated if structure changes on the website
- Keep CLI output user-friendly and readable
- Maintain backward compatibility when possible

## Notes for Agents

- This is a minimal Bun project, use Bun's built-in features
- No build step required - TypeScript is transpiled on the fly
- Focus on readability and maintainability
- Add tests for new functionality when appropriate
- Document any breaking changes in this file
