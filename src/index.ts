import { parseHtml, fetchHtml } from "./html-parser.js";
import { buildTree } from "./tree-builder.js";
import { displayResults } from "./display.js";
import { 
  printUsage, 
  printNoResults, 
  printSearching, 
  printResults, 
  printError 
} from "./cli.js";

async function main() {
  const searchTerms = process.argv.slice(2);

  if (searchTerms.length === 0) {
    printUsage();
    process.exit(0);
  }

  printSearching(searchTerms);

  try {
    const html = await fetchHtml();
    console.log();
    
    // Parse all results (no search terms) to get all directory links
    const allResults = parseHtml(html, []);
    
    // Parse filtered results for search
    const searchResults = parseHtml(html, searchTerms);

    if (searchResults.length === 0) {
      printNoResults();
      process.exit(0);
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

main();