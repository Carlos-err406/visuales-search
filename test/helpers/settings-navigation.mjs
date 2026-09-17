export function settingsPage(page, name) {
  return page.getByRole("tablist", { name: "Workspace" }).getByRole("tab", { name, exact: true }).click();
}
