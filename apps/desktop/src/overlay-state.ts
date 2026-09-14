/** Closed Base UI popups can retain their role-bearing children while mounted or animating out. */
export function hasOpenOverlay(): boolean {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"]'
    ),
  ].some(
    (element) =>
      !element.closest("[hidden], [data-closed], [data-ending-style]") &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden"
  );
}
