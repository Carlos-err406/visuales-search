# visuales-search

A search tool for visuales.uclv.cu content - fetches the listado.html page and searches through all links.

## Installation

```bash
bun install
```

## Usage

### Single Search Term

```bash
bun run index.ts <query>
# Example:
bun run index.ts photoshop
```

### Multiple Search Terms (AND Logic)

All search terms must be present in the result to be included:

```bash
bun run index.ts <term1> <term2> <term3>...
# Example:
bun run index.ts course beginners photoshop
```

### Using the Shortcut Script

```bash
bun run search <query>
```

## Features

- Fetches HTML from https://visuales.uclv.cu/listado.html
- **Caching**: HTML is cached locally for 24 hours to speed up subsequent searches
- Searches in both link text and URL paths (case-insensitive)
- Supports multiple search terms with AND logic
- Groups results by directory path in a tree structure
- Displays results with colored output and Unicode tree characters
- Normalizes URLs and removes duplicate slashes

## Cache

The HTML content is cached locally in `.cache/listado.html.json` for 24 hours. Subsequent searches will use the cached data unless it has expired, significantly improving performance.

## Output Format

Results are grouped by directory and displayed with:
- Yellow/bold directory names
- Cyan link text
- Gray/dim URLs
- Unicode tree characters for hierarchy

This project was created using `bun init` in Bun v1.3.2. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
