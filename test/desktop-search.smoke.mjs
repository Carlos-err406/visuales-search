/* global window, document, getComputedStyle */
import assert from "node:assert/strict";

async function checkTreeAlignment(page) {
  const rows = await page.getByRole("treeitem").evaluateAll((elements) =>
    elements.map((row) => ({
      depth: Number(row.getAttribute("aria-level")),
      actions: row.querySelector(".tree-actions").getBoundingClientRect().right,
      icon: row.querySelector(".file-symbol").getBoundingClientRect().x,
      name: row.querySelector(".file-title").getBoundingClientRect().x,
    }))
  );
  assert.equal(await page.getByRole("tree").getByRole("checkbox").count(), 0);
  for (const row of rows) {
    assert.equal(row.actions, rows[0].actions, "actions remain right aligned at every depth");
  }
  for (const row of rows) {
    assert.equal(row.icon - rows[0].icon, (row.depth - rows[0].depth) * 18, "only folder/file content is indented");
    assert.equal(row.name - row.icon, rows[0].name - rows[0].icon, "names have consistent spacing after icons");
  }
  assert.equal(await page.getByRole("tree").locator("[title]").count(), 0, "rows have no native name tooltips");
}

export async function testSearchBrowsing({ page, screenshots, checkLayout }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.evaluate(() => {
    const entry = (path) => ({
      encodedUrl: `https://visuales.uclv.cu${path}`,
      url: `https://visuales.uclv.cu${path}`,
      text: decodeURIComponent(path.replace(/\/$/, "").split("/").at(-1)),
      directory: "/Movies",
      isDirectoryLink: path.endsWith("/"),
      size: path.endsWith("/") ? undefined : 72,
    });
    window.testBridge.results = [
      entry("/Movies/Example/"),
      entry("/Movies/Example/notes.txt"),
      entry("/Movies/Other/"),
    ];
    window.testBridge.directoryEntries = {
      "https://visuales.uclv.cu/Movies/Example/": [
        entry("/Movies/Example/notes.txt"),
        entry("/Movies/Example/cover.png"),
        entry("/Movies/Example/Extras/"),
      ],
    };
  });
  await page.getByRole("searchbox", { name: "Search library" }).fill("Example");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("treeitem", { name: "Example", exact: true }).waitFor();
  const example = page.getByRole("treeitem", { name: "Example", exact: true });
  const extras = page.getByRole("treeitem", { name: "Extras", exact: true });
  assert.equal(await page.locator(".selection-bar").count(), 0);
  const lastTransfer = () =>
    page.evaluate(() => window.testBridge.calls.filter((call) => call.command === "start_download").at(-1).args);
  await page.getByRole("button", { name: "Download Example", exact: true }).click();
  await page.getByText("Transfer started", { exact: true }).waitFor();
  assert.deepEqual((await lastTransfer()).urls, ["https://visuales.uclv.cu/Movies/Example/"]);
  assert.equal((await lastTransfer()).queue, false);
  assert.equal(await example.getAttribute("aria-expanded"), "true", "row action does not toggle folder");
  assert.equal(await page.locator(".selection-bar").count(), 0, "individual actions do not stage items");
  await page.getByRole("button", { name: "Queue notes.txt", exact: true }).click();
  await page.getByText("Transfer added to queue", { exact: true }).waitFor();
  assert.deepEqual((await lastTransfer()).urls, ["https://visuales.uclv.cu/Movies/Example/notes.txt"]);
  assert.equal((await lastTransfer()).queue, true);
  assert.equal(await page.getByRole("dialog").count(), 0, "row action does not preview file");
  await page.evaluate(() => {
    window.testBridge.fail = "start_download";
  });
  await page.getByRole("button", { name: "Download Other", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: start_download" }).waitFor();
  assert.equal(await page.locator(".selection-bar").count(), 0, "direct action errors remain visible without a footer");
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  assert.equal(await page.getByRole("tree").locator(".lucide-chevron-down, .lucide-chevron-right").count(), 0);
  assert.equal(await example.locator(".lucide-folder-open").count(), 1);
  assert.equal(await example.locator(".tree-size").count(), 0, "folders do not show sizes");
  assert.equal(await page.getByRole("button", { name: /^List contents of / }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Refresh Example", exact: true }).count(), 0);
  assert.equal(await page.getByRole("treeitem", { name: "notes.txt", exact: true }).getAttribute("aria-level"), "3");
  await page.getByRole("treeitem", { name: "notes.txt", exact: true }).click({ modifiers: ["Meta"] });
  assert.equal(await page.getByRole("dialog").count(), 0, "modifier selection does not preview");
  await page.getByRole("button", { name: "Queue Other", exact: true }).click();
  await page.getByText("Transfer added to queue", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("treeitem", { name: "notes.txt", exact: true }).getAttribute("aria-selected"),
    "true",
    "individual actions preserve staged items"
  );
  assert.equal(await page.locator(".selection-bar").count(), 1);
  await example.click();
  assert.equal(await example.getAttribute("aria-expanded"), "false");
  assert.equal(await example.locator(".lucide-folder").count(), 1);
  assert.equal(await page.getByRole("treeitem", { name: "notes.txt", exact: true }).count(), 0);
  await page.evaluate(() => {
    window.testBridge.holdListing = true;
    delete window.testBridge.releaseListing;
  });
  await example.click();
  await page.waitForFunction(() => Boolean(window.testBridge.releaseListing));
  await page.getByRole("treeitem", { name: "notes.txt", exact: true }).waitFor();
  assert.equal(await example.getAttribute("aria-busy"), "true");
  assert.equal(
    await page.getByText("Loading folder contents", { exact: true }).count(),
    0,
    "known children remain visible without a blocking loading row"
  );
  await example.getByRole("status", { name: "Refreshing folder contents", exact: true }).waitFor();
  await page.evaluate(() => {
    window.testBridge.holdListing = false;
    window.testBridge.releaseListing();
  });
  await page.getByRole("treeitem", { name: "cover.png", exact: true }).waitFor();
  assert.equal(await example.getAttribute("aria-busy"), null, "successful listing clears busy state");
  assert.equal(await example.getByRole("status").count(), 0, "refresh spinner clears with loaded contents");
  await page.getByRole("button", { name: "Refresh Example", exact: true }).waitFor();
  assert.equal(await example.getAttribute("aria-expanded"), "true");
  assert.equal(await example.locator(".lucide-folder-open").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Refresh Extras", exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("treeitem", { name: "notes.txt", exact: true }).count(),
    1,
    "listing merges matching children"
  );
  assert.equal(
    await page.getByRole("treeitem", { name: "notes.txt", exact: true }).getAttribute("aria-selected"),
    "true"
  );
  const count = await page.evaluate(
    () => window.testBridge.calls.filter((call) => call.command === "list_library_directory").length
  );
  await example.click();
  await example.click();
  assert.equal(
    await page.evaluate(
      () => window.testBridge.calls.filter((call) => call.command === "list_library_directory").length
    ),
    count
  );
  await example.click({ modifiers: ["Meta"] });
  assert.equal(await example.getAttribute("aria-expanded"), "true", "modifier selection does not collapse folders");
  for (const name of ["Example", "Extras", "cover.png", "notes.txt"]) {
    assert.equal(await page.getByRole("treeitem", { name, exact: true }).getAttribute("aria-selected"), "true");
  }
  await page.getByRole("treeitem", { name: "cover.png", exact: true }).click({ modifiers: ["Meta"] });
  assert.equal(await example.getAttribute("data-selection"), "partial");
  await page.screenshot({ path: `${screenshots}/search-partial-selection.png` });
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await page.waitForFunction(() =>
    window.testBridge.calls.some(
      (call) =>
        call.command === "start_download" &&
        call.args.urls.includes("https://visuales.uclv.cu/Movies/Example/notes.txt")
    )
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.testBridge.calls
        .filter((call) => call.command === "start_download")
        .at(-1)
        .args.urls.sort()
    ),
    ["https://visuales.uclv.cu/Movies/Example/Extras/", "https://visuales.uclv.cu/Movies/Example/notes.txt"],
    "excluded file must not be included by a whole-folder download"
  );
  await example.click({ modifiers: ["Meta"] });
  assert.equal(await example.getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.testBridge.calls.filter((call) => call.command === "start_download").at(-1)?.args.urls[0] ===
      "https://visuales.uclv.cu/Movies/Example/"
  );
  assert.deepEqual(
    await page.evaluate(
      () => window.testBridge.calls.filter((call) => call.command === "start_download").at(-1).args.urls
    ),
    ["https://visuales.uclv.cu/Movies/Example/"]
  );
  const note = page.getByRole("treeitem", { name: "notes.txt", exact: true });
  await note.click({ modifiers: ["Meta"] });
  await note.click();
  await page.getByRole("dialog").locator("pre").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await note.getAttribute("aria-selected"), "true", "closing a preview preserves selection");
  await page.getByRole("button", { name: "Download notes.txt", exact: true }).hover();
  await page.getByRole("tooltip").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  assert.equal(await note.getAttribute("aria-selected"), "true", "dismissing a tooltip preserves selection");
  await page.mouse.move(0, 0);
  await note.focus();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".selection-bar").count(), 0, "Escape clears staging and hides the footer");
  assert.equal(await note.getAttribute("aria-selected"), "false");
  assert.equal(await note.evaluate((el) => el === document.activeElement), true, "Escape retains row focus");
  assert.equal(await example.getAttribute("aria-expanded"), "true", "Escape does not collapse folders");
  assert.equal(await page.getByRole("searchbox", { name: "Search library" }).inputValue(), "Example");
  await page.keyboard.press("Space");
  await page.getByRole("textbox", { name: "Download destination", exact: true }).focus();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".selection-bar").count(), 0, "Escape also clears staging from the footer");
  await note.click();
  await page.getByRole("dialog").locator("pre").waitFor();
  assert.equal(await page.evaluate(() => window.remoteExecuted), undefined, "remote text stays inert");
  await page.screenshot({ path: `${screenshots}/search-text-preview.png` });
  await page.getByRole("button", { name: "Refresh preview", exact: true }).hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.filter({ hasText: "Refresh preview" }).waitFor();
  assert.equal(
    await tooltip.evaluate((el) => {
      const positioner = el.closest(".tooltip-positioner");
      const dialog = document.querySelector('[role="dialog"]');
      return Number(getComputedStyle(positioner).zIndex) > Number(getComputedStyle(dialog).zIndex);
    }),
    true,
    "tooltip portal stacks above the preview dialog"
  );
  await page.screenshot({ path: `${screenshots}/preview-tooltip.png` });
  await page.getByRole("button", { name: "Close preview", exact: true }).hover();
  await tooltip.filter({ hasText: "Close preview" }).waitFor();
  await page.mouse.move(0, 0);
  await tooltip.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await note.evaluate((el) => el === document.activeElement), true, "closing preview restores focus");
  await note.click();
  await page.getByText(/Cached/).waitFor();
  await page.getByRole("button", { name: "Refresh preview", exact: true }).click();
  await page.getByText(/Fetched/).waitFor();
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.getByRole("treeitem", { name: "cover.png", exact: true }).click();
  await page.getByRole("dialog").getByRole("img").waitFor();
  await page.waitForFunction(() => document.querySelector(".preview-body img")?.naturalWidth > 0);
  await page.screenshot({ path: `${screenshots}/search-image-preview.png` });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.testBridge.fail = "list_library_directory";
  });
  await extras.click();
  await page.getByRole("alert").filter({ hasText: "Test failure: list_library_directory" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Folder is empty").waitFor();
  assert.equal(await extras.locator(".tree-size").count(), 0);
  assert.equal(await example.locator(".tree-size").count(), 0, "folder sizes stay hidden after listing");
  await example.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await example.getAttribute("aria-expanded"), "false");
  await page.keyboard.press("Enter");
  assert.equal(await example.getAttribute("aria-expanded"), "true");
  const other = page.getByRole("treeitem", { name: "Other", exact: true });
  await page.evaluate(() => {
    window.testBridge.holdListing = true;
    delete window.testBridge.releaseListing;
  });
  await other.click();
  await page.waitForFunction(() => Boolean(window.testBridge.releaseListing));
  const otherFeedback = other.locator("..").locator(".tree-feedback");
  await otherFeedback.getByText("Loading folder contents", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.testBridge.holdListing = false;
    window.testBridge.releaseListing();
  });
  await otherFeedback.getByText("Folder is empty", { exact: true }).waitFor();
  assert.equal(await other.getAttribute("aria-busy"), null, "empty listing also clears busy state");
  assert.equal(await page.getByText("Loading folder contents", { exact: true }).count(), 0);
  await other.click();
  await other.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page.getByRole("treeitem", { name: "Movies", exact: true }).evaluate((el) => el === document.activeElement),
    true
  );
  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: theme, exact: true }).click();
    await page.getByRole("tab", { name: "Search", exact: true }).click();
    for (const width of [1240, 760, 390]) {
      await page.setViewportSize({ width, height: 820 });
      await checkTreeAlignment(page);
      await checkLayout(`search-tree-${theme.toLowerCase()}-${width}`);
    }
    await note.click();
    await page.getByRole("dialog").locator("pre").waitFor();
    await page.screenshot({ path: `${screenshots}/text-preview-${theme.toLowerCase()}-390.png` });
    await page.keyboard.press("Escape");
  }
  // A late directory response must not inject files into a replacement search.
  await page.evaluate(() => {
    window.testBridge.holdListing = true;
  });
  await page.getByRole("button", { name: "Refresh Example", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.testBridge.releaseListing));
  await page.evaluate(() => {
    window.testBridge.results = [];
  });
  await page.getByRole("searchbox", { name: "Search library" }).fill("nothing");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No matching results", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.testBridge.holdListing = false;
    window.testBridge.releaseListing();
  });
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole("treeitem").count(), 0);
}
