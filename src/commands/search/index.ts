import { Command } from "commander";
import colors from "ansi-colors";
import { parseHtml, fetchHtml } from "../../lib/html-parser.js";
import { buildTree } from "./tree-builder.js";
import { displayResults } from "./display.js";

// Helper functions for Search
export function printUsage(): void {
  console.log(colors.yellow("Usage: visuales search <query1> <query2>..."));
  console.log(
    colors.gray("Example: visuales search photoshop course beginners")
  );
  console.log(
    colors.gray("\nNote: ALL search terms must be present in the result.")
  );
}

export function printNoResults(): void {
  console.log(colors.red("❌ No results found"));
  console.log(colors.gray("Try with fewer or different search terms"));
}

export function printSearching(searchTerms: string[]): void {
  console.log(colors.blue(`Searching for: ${searchTerms.join(", ")}`));
  console.log();
}

export function printResults(count: number): void {
  console.log(colors.green(`✅ Found ${count} result(s)`));
}

export function printError(error: unknown): void {
  console.error(colors.red("❌ Error:"));
  if (error instanceof Error) {
    console.error(colors.red(error.message));
  } else {
    console.error(colors.red(String(error)));
  }
}

async function searchCommand(terms: string[]) {
  if (terms.length === 0) {
    console.log(colors.yellow("Please provide at least one search term"));
    console.log(
      colors.gray("Example: visuales search photoshop course beginners")
    );
    return;
  }

  printSearching(terms);

  try {
    const html = await fetchHtml();
    console.log();

    // Parse all results (no search terms) to get all directory links
    const allResults = parseHtml(html, []);

    // Parse filtered results for search
    const searchResults = parseHtml(html, terms);

    if (searchResults.length === 0) {
      printNoResults();
      return;
    }

    // Build tree with all directory URLs available
    const tree = buildTree(searchResults, allResults);
    displayResults(tree);

    printResults(searchResults.length);
  } catch (error) {
    printError(error);
    process.exit(1);
  }
}

export function setupSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search for content on visuales.uclv.cu")
    .argument("<terms...>", "search terms (all must be present in results)")
    .action(searchCommand);
}
