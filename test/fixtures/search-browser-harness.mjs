/* global document */
import { createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { useSearchBrowser } from "../../apps/desktop/src/search-tree.tsx";

export function mountSearchBrowser(results) {
  let current;
  function Harness() {
    const browser = useSearchBrowser(results, false);
    useLayoutEffect(() => {
      current = browser;
    });
    return null;
  }
  const element = document.createElement("div");
  const root = createRoot(element);
  root.render(createElement(Harness));
  return { snapshot: () => current, dispose: () => root.unmount() };
}
