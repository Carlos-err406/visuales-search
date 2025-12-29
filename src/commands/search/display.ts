import colors from "ansi-colors";
import { type TreeNode, type DisplayOptions } from "../../lib/types.js";

export function makeLink(text: string, url: string): string {
  const linkStart = `\x1b]8;;${url}\x1b\\`;
  const linkEnd = `\x1b]8;;\x1b\\`;
  return `${linkStart}${text}${linkEnd}`;
}

export function displayTree(node: TreeNode, options: DisplayOptions): void {
  const { prefix, isLast, isRoot } = options;
  const treePrefix = isRoot ? "" : isLast ? "└── " : "├── ";
  const continuation = isRoot ? "" : isLast ? "    " : "│   ";

  if (!isRoot) {
    if (node.isDirectoryLink && node.ownUrl) {
      const linkText = makeLink(node.name, node.ownUrl);
      console.log(
        `${prefix}${colors.gray.dim(treePrefix)}${colors.cyan(linkText)}/`
      );
    } else {
      console.log(
        `${prefix}${colors.gray.dim(treePrefix)}${colors.yellow.bold(
          node.name
        )}/`
      );
    }
  }

  // Show URL for any node that has a URL (directory or result)
  if (node.isDirectoryLink && node.ownUrl && node.ownEncodedUrl) {
    console.log(
      `${prefix}${colors.gray.dim(continuation)}${colors.dim(
        node.ownEncodedUrl
      )}`
    );
  }

  const sortedChildren = Array.from(node.children.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  if (node.results.length > 0) {
    const resultsPrefix = isRoot ? "" : colors.gray.dim(continuation);

    node.results.forEach((result, index) => {
      const isResultLast =
        index === node.results.length - 1 && node.children.size === 0;
      const resultPrefix = colors.gray.dim(isResultLast ? "└── " : "├── ");
      const resultContinuation = colors.gray.dim(
        isResultLast ? "    " : "│   "
      );

      const linkText = makeLink(result.text, result.url);
      console.log(
        `${prefix}${resultsPrefix}${resultPrefix}${colors.cyan(linkText)}`
      );
      console.log(
        `${prefix}${resultsPrefix}${resultContinuation}${colors.dim(
          result.encodedUrl
        )}`
      );
    });
  }

  if (node.children.size > 0) {
    const separatorPrefix = isRoot ? "" : colors.gray.dim(continuation);
    console.log(`${prefix}${separatorPrefix}${colors.gray.dim("│")}`);
  }

  sortedChildren.forEach(([name, child], index) => {
    const isChildLast = index === sortedChildren.length - 1;
    const dimmedContinuation = colors.gray.dim(continuation);
    displayTree(child, {
      prefix: `${prefix}${dimmedContinuation}`,
      isLast: isChildLast,
      isRoot: false,
    });
  });
}

export function displayResults(root: Map<string, TreeNode>): void {
  const sortedChildren = Array.from(root.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  sortedChildren.forEach(([name, node], index) => {
    const isLast = index === sortedChildren.length - 1;
    displayTree(node, { prefix: "", isLast, isRoot: false });
  });
}
