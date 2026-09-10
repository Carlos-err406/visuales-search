import type { LibraryEntry } from "./library-types.js";

export interface SearchTreeNode {
  url: string;
  name: string;
  directory: boolean;
  entry?: LibraryEntry;
  parent?: string;
  children: SearchTreeNode[];
}

// Index and Apache listings escape names differently. Normalize each segment
// separately so an encoded slash remains part of a name, not a path separator.
export function canonicalTreeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.pathname = url.pathname
      .split("/")
      .map((part) => {
        try {
          return encodeURIComponent(decodeURIComponent(part));
        } catch {
          return part;
        }
      })
      .join("/");
    return url.href;
  } catch {
    return value;
  }
}

export function buildSearchTree(entries: LibraryEntry[]): SearchTreeNode[] {
  const nodes = new Map<string, SearchTreeNode>();
  const roots: SearchTreeNode[] = [];
  for (const entry of entries) {
    let parsed: URL;
    try {
      parsed = new URL(canonicalTreeUrl(entry.encodedUrl));
    } catch {
      continue;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    let parent: SearchTreeNode | undefined;
    for (let index = 0; index < parts.length; index++) {
      const leaf = index === parts.length - 1;
      const directory = !leaf || entry.isDirectoryLink;
      const url = leaf ? parsed.href : `${parsed.origin}/${parts.slice(0, index + 1).join("/")}/`;
      let node = nodes.get(url);
      if (!node) {
        let name = parts[index];
        try {
          name = decodeURIComponent(name);
        } catch {
          /* Keep malformed escapes readable. */
        }
        node = { url, name, directory, parent: parent?.url, children: [] };
        nodes.set(url, node);
        (parent ? parent.children : roots).push(node);
      }
      if (leaf) {
        node.entry = entry;
        node.name = entry.text || node.name;
      }
      parent = node;
    }
  }
  function sort(nodes: SearchTreeNode[]) {
    nodes.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    nodes.forEach((node) => sort(node.children));
  }
  sort(roots);
  return roots;
}

// A selected directory already includes its descendants; never start duplicate overlapping downloads.
export function distinctDownloadUrls(urls: Iterable<string>): string[] {
  const unique = [...new Set(urls)];
  const selected = new Set(unique);
  return unique.filter((url) => {
    for (let slash = url.indexOf("/"); slash >= 0 && slash < url.length - 1; slash = url.indexOf("/", slash + 1)) {
      if (selected.has(url.slice(0, slash + 1))) return false;
    }
    return true;
  });
}

export type TreeCheckState = boolean | "indeterminate";

export function treeSelectionStates(
  tree: SearchTreeNode[],
  selected: ReadonlySet<string>
): Map<string, TreeCheckState> {
  const states = new Map<string, TreeCheckState>();
  function visit(node: SearchTreeNode, inherited: boolean): TreeCheckState {
    const checked = inherited || selected.has(node.url);
    const children = node.children.map((child) => visit(child, checked));
    const state =
      checked || (children.length > 0 && children.every((value) => value === true))
        ? true
        : children.some((value) => value !== false)
          ? "indeterminate"
          : false;
    states.set(node.url, state);
    return state;
  }
  tree.forEach((node) => visit(node, false));
  return states;
}

export function changeTreeSelection(
  tree: SearchTreeNode[],
  selected: ReadonlySet<string>,
  targets: ReadonlySet<string>,
  checked: boolean
): Set<string> {
  const next = new Set<string>();
  function visit(node: SearchTreeNode, inherited: boolean, insideTarget: boolean): boolean {
    const targeted = insideTarget || targets.has(node.url);
    const wasSelected = inherited || selected.has(node.url);
    let containsTarget = targeted;
    for (const child of node.children) {
      if (visit(child, wasSelected, targeted)) containsTarget = true;
    }
    // Unchecking a descendant splits selected ancestors into the remaining known
    // targets. Keeping a whole-folder target would download the excluded child.
    if (node.entry && (targeted ? checked : wasSelected) && (checked || !containsTarget)) next.add(node.url);
    return containsTarget;
  }
  tree.forEach((node) => visit(node, false, false));
  return next;
}
