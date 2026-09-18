/* global window, document */
import assert from "node:assert/strict";

export async function testLibraryWindows({ browser, screenshots, baseURL = process.env.DESKTOP_URL }) {
  const context = await browser.newContext({
    viewport: { width: 820, height: 680 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const errors = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  await context.addInitScript(() => {
    const base = "https://visuales.uclv.cu/Movies/Example/";
    const entry = (suffix) => ({
      url: base + suffix,
      encodedUrl: base + suffix,
      text: suffix.replace(/\/$/, "").split("/").at(-1),
      directory: base,
      isDirectoryLink: suffix.endsWith("/"),
      modifiedLocal: suffix === "notes.txt" ? "2026-09-18T10:00" : undefined,
      modifiedCheckedAt: 100,
    });
    const folder = new URLSearchParams(window.location.search).has("folder");
    const image = new URLSearchParams(window.location.search).has("image");
    const events = new Map();
    const callbacks = new Map();
    let next = 0;
    const settings = {
      output: "/Downloads/Visuales",
      concurrent: 5,
      connections: 3,
      maxRetries: 3,
      exclude: [],
      notifyCompleted: true,
      notifyFailed: true,
    };
    const state = (window.libraryTest = {
      calls: [],
      hold: true,
      fail: false,
      cached: image,
      phase: "waiting",
      resource: {
        url: folder ? base : base + (image ? "cover.png" : "notes.txt"),
        name: folder ? "Example" : image ? "cover.png" : "notes.txt",
        kind: folder ? "folder" : "preview",
        revision: 0,
      },
      entries: [
        entry("Extras/"),
        entry("Extras/deep.txt"),
        entry("notes.txt"),
        entry("cover.png"),
        entry("second.png"),
        entry("movie.mp4"),
      ],
      release: () => {},
      emit: (name) => {
        const callback = callbacks.get(events.get(name));
        if (callback) callback({ event: name, payload: null });
      },
    });
    const content = (url, cached = false) => ({
      url,
      kind: url.endsWith(".png") ? "image" : "text",
      mime: url.endsWith(".png") ? "image/png" : "text/plain",
      content: url.endsWith(".png")
        ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
        : "<script>window.remoteExecuted = true</script>\nHello library\nHello again\nLiteral %20 stays in preview content",
      bytes: 72,
      cached,
      fetchedAt: Date.now(),
    });
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {
        const id = ++next;
        callbacks.set(id, callback);
        return id;
      },
      async invoke(command, args = {}) {
        state.calls.push({ command, args });
        if (command === "plugin:event|listen") {
          events.set(args.event, args.handler);
          return args.handler;
        }
        if (command === "plugin:event|unlisten") return;
        if (command === "library_window_context") return state.resource;
        if (command === "app_update_info") return { currentVersion: "3.3.1", supported: false, automatic: false };
        if (command === "get_desktop_settings") return { settings, defaults: settings };
        if (command === "cached_library_preview") return state.cached ? content(args.url, true) : null;
        if (command === "library_preview_status") return state.phase;
        if (command === "preview_library_file") {
          if (state.hold)
            await new Promise((resolve) => {
              state.release = resolve;
            });
          if (state.fail) throw new Error("Preview fixture offline");
          return content(args.url, !args.refresh && state.cached);
        }
        if (command === "list_library_directory")
          return state.entries.filter(
            (entry) =>
              entry.encodedUrl.startsWith(args.url) &&
              !entry.encodedUrl.slice(args.url.length).replace(/\/$/, "").includes("/")
          );
        if (command === "search_content")
          return {
            results: [
              ...state.entries,
              { ...entry("stranger.txt"), encodedUrl: "https://visuales.uclv.cu/Other/stranger.txt" },
            ].filter(
              (entry) =>
                (!args.root || entry.encodedUrl.startsWith(args.root)) &&
                args.terms.every((term) => entry.text.includes(term))
            ),
          };
        if (command === "list_download_tasks") return [];
        if (command === "start_download") return { id: "test-transfer" };
        if (command === "navigate_preview") {
          state.resource = { ...state.resource, url: args.url, name: args.url.split("/").at(-1) };
          state.emit("library-window-changed");
          return "library-1";
        }
        return null;
      },
    };
  });
  try {
    const text = await context.newPage();
    await text.goto(`${baseURL}?library-window`);
    await text.getByText("Waiting for preview", { exact: true }).waitFor();
    await text.evaluate(() => {
      window.libraryTest.phase = "loading";
    });
    await text.getByText("Loading preview", { exact: true }).waitFor();
    await text.evaluate(() => {
      window.libraryTest.hold = false;
      window.libraryTest.release();
    });
    await text.locator("pre").waitFor();
    assert.equal(await text.evaluate(() => window.remoteExecuted), undefined);
    await text.getByRole("textbox", { name: "Find in preview" }).fill("Hello");
    assert.equal(await text.locator("mark").count(), 2);
    await text.getByRole("button", { name: "Next match", exact: true }).click();
    assert.equal(await text.locator('mark[data-current="true"]').textContent(), "Hello");
    await text.getByRole("button", { name: "Word wrap", exact: true }).click();
    assert.equal(await text.locator("pre").getAttribute("class"), "");
    await text.getByRole("button", { name: "Download now", exact: true }).click();
    await text.getByText("Transfer started", { exact: true }).waitFor();
    await text.getByRole("button", { name: "Show in Search", exact: true }).click();
    assert.ok(await text.evaluate(() => window.libraryTest.calls.some((call) => call.command === "show_in_search")));
    await text.screenshot({ path: `${screenshots}/detached-text.png` });

    const encoded = "https://visuales.uclv.cu/Cursos/Part%201/notes%20%23%20caf%C3%A9%20%2520.txt";
    await text.evaluate((url) => {
      window.libraryTest.resource = {
        url,
        name: "notes # caf\u00e9 %20.txt",
        kind: "preview",
        revision: 1,
      };
      window.libraryTest.emit("library-window-changed");
    }, encoded);
    await text.getByRole("heading", { name: "notes # caf\u00e9 %20.txt", exact: true }).waitFor();
    await text.getByText("/Cursos/Part 1/notes # caf\u00e9 %20.txt", { exact: true }).waitFor();
    await text.getByText("Literal %20 stays in preview content", { exact: false }).waitFor();
    await text.getByRole("button", { name: "Download now", exact: true }).click();
    await text.getByText("Transfer started", { exact: true }).waitFor();
    const previewCalls = await text.evaluate(() => window.libraryTest.calls);
    assert.equal(previewCalls.filter((call) => call.command === "preview_library_file").at(-1).args.url, encoded);
    assert.deepEqual(previewCalls.filter((call) => call.command === "start_download").at(-1).args.urls, [encoded]);
    await text.screenshot({ path: `${screenshots}/decoded-preview-path.png` });

    const image = await context.newPage();
    await image.goto(`${baseURL}?library-window&image`);
    await image.getByRole("img").waitFor();
    assert.equal(
      await image.locator(".detached-preview-body").getAttribute("aria-busy"),
      "true",
      "cached image displays before queued request resolves"
    );
    await image.evaluate(() => {
      window.libraryTest.hold = false;
      window.libraryTest.release();
    });
    await image.getByRole("button", { name: "Actual size", exact: true }).click();
    await image.getByRole("button", { name: "Zoom in", exact: true }).click();
    await image.waitForFunction(() => Number(document.querySelector(".zoom-value").textContent.replace("%", "")) > 100);
    await image.getByRole("button", { name: "Fit to window", exact: true }).click();
    await image.getByRole("button", { name: "Next image", exact: true }).click();
    await image.getByRole("heading", { name: "second.png", exact: true }).waitFor();
    await image.getByRole("button", { name: "Previous image", exact: true }).click();
    await image.getByRole("heading", { name: "cover.png", exact: true }).waitFor();
    await image.evaluate(() => {
      window.libraryTest.fail = true;
    });
    await image.getByRole("button", { name: "Refresh preview", exact: true }).click();
    await image.getByRole("alert").filter({ hasText: "offline" }).waitFor();
    assert.equal(await image.getByRole("img").count(), 1, "refresh failure keeps cached image visible");
    await image.screenshot({ path: `${screenshots}/detached-image.png` });

    const folder = await context.newPage();
    await folder.setViewportSize({ width: 1240, height: 820 });
    await folder.goto(`${baseURL}?library-window&folder`);
    await folder.getByRole("treeitem", { name: "Extras", exact: true }).waitFor();
    assert.equal(await folder.getByRole("treeitem", { name: "stranger.txt", exact: true }).count(), 0);
    await folder.getByRole("treeitem", { name: "movie.mp4", exact: true }).click({ button: "right" });
    await folder.getByRole("menuitem", { name: "Download Now", exact: true }).waitFor();
    assert.equal(
      await folder.getByRole("menu").locator(":scope > :first-child").getAttribute("role"),
      "menuitem",
      "no leading separator for video"
    );
    await folder.keyboard.press("Escape");
    assert.equal(await folder.getByRole("tab").count(), 4, "folder windows reuse main navigation");
    assert.equal(await folder.getByRole("tab", { name: "About", exact: true }).isVisible(), true);
    await folder.getByRole("searchbox", { name: "Search library" }).fill("deep");
    await folder.getByRole("button", { name: "Search", exact: true }).click();
    await folder.getByRole("treeitem", { name: "deep.txt", exact: true }).waitFor();
    await folder.getByRole("button", { name: "Clear search", exact: true }).click();
    await folder.getByRole("treeitem", { name: "Extras", exact: true }).click();
    await folder.getByRole("treeitem", { name: "deep.txt", exact: true }).waitFor();
    await folder.getByRole("treeitem", { name: "notes.txt", exact: true }).waitFor();
    await folder.getByRole("treeitem", { name: "notes.txt", exact: true }).click({ modifiers: ["Meta"] });
    await folder.getByRole("treeitem", { name: "cover.png", exact: true }).click({ modifiers: ["Meta"] });
    await folder.getByRole("button", { name: "Queue", exact: true }).click();
    await folder.getByText("Transfer added to queue", { exact: true }).waitFor();
    assert.equal(await folder.locator(".selection-bar").count(), 0);
    const calls = await folder.evaluate(() =>
      window.libraryTest.calls.filter((call) => call.command === "search_content")
    );
    assert.ok(
      calls.length >= 2 && calls.every((call) => call.args.root === "https://visuales.uclv.cu/Movies/Example/")
    );
    assert.ok(
      calls.some((call) => call.args.terms.join() === "deep"),
      "query goes to scoped core search"
    );
    await folder.getByRole("tab", { name: /Downloads/ }).click();
    await folder.getByRole("heading", { name: "Downloads", exact: true }).waitFor();
    await folder.getByRole("tab", { name: "Settings", exact: true }).click();
    await folder.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await folder.getByRole("tab", { name: "Search", exact: true }).click();
    await folder.getByRole("combobox", { name: "Sort search results" }).click();
    await folder.getByRole("option", { name: "Modified: newest first", exact: true }).click();
    assert.deepEqual(
      await folder
        .locator('[role="treeitem"][aria-level="1"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label"))),
      ["Extras", "notes.txt", "cover.png", "movie.mp4", "second.png"],
      "folder windows apply the same cached date ordering within their root"
    );
    assert.equal(
      await folder.getByRole("treeitem", { name: "notes.txt", exact: true }).locator("time").getAttribute("datetime"),
      "2026-09-18",
      "folder windows display the same server-local modified date"
    );
    for (const target of [text, image, folder]) {
      for (const width of target === folder ? [1240, 760] : [820, 480]) {
        await target.setViewportSize({ width, height: 680 });
        assert.ok(
          await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          "window must not overflow horizontally"
        );
      }
    }
    await folder.screenshot({ path: `${screenshots}/folder-window.png` });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
