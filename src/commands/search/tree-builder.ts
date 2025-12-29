import { type SearchResult, type TreeNode } from "../../lib/types.js";

export function buildTree(
  results: SearchResult[],
  allResults: SearchResult[]
): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>();

  // First, collect all directory URLs from all results
  const allDirectoryUrls = new Map<
    string,
    { url: string; encodedUrl: string }
  >();

  for (const result of allResults) {
    if (result.isDirectoryLink) {
      allDirectoryUrls.set(result.directory, {
        url: result.url,
        encodedUrl: result.encodedUrl,
      });
    }
  }

  for (const result of results) {
    const parts = result.directory
      .split("/")
      .filter((part) => part && part.length > 0) as string[];
    let currentMap: Map<string, TreeNode> = root;

    let currentPath = "";
    let lastNode: TreeNode | undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      currentPath += `/${part}`;

      let node = currentMap.get(part);
      if (!node) {
        const newNode: TreeNode = {
          name: part,
          fullPath: currentPath,
          children: new Map(),
          results: [],
          isDirectoryLink: false,
        };
        node = newNode;
        currentMap.set(part, node);
      }

      lastNode = node;
      currentMap = node.children;
    }

    if (lastNode) {
      const isSelfReferential =
        result.url.endsWith("/") && result.text === lastNode!.name;

      if (!isSelfReferential) {
        lastNode.results.push(result);
      } else {
        lastNode.isDirectoryLink = true;
        lastNode.ownUrl = result.url;
        lastNode.ownEncodedUrl = result.encodedUrl;
      }
    }
  }

  // Now set URLs for all directories that have them
  function setDirectoryUrls(node: TreeNode): void {
    // Check if this node has a directory URL
    const dirInfo = allDirectoryUrls.get(node.fullPath);
    if (dirInfo) {
      node.isDirectoryLink = true;
      node.ownUrl = dirInfo.url;
      node.ownEncodedUrl = dirInfo.encodedUrl;
    }

    // Recursively set URLs for children
    for (const child of node.children.values()) {
      setDirectoryUrls(child);
    }
  }

  for (const node of root.values()) {
    setDirectoryUrls(node);
  }

  return root;
}
