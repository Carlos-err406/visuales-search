/* global window, document */
import assert from "node:assert/strict";

export async function testUriDisplay({ page, screenshots }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.getByRole("treeitem", { name: "Library", exact: true }).waitFor();
  const url = "https://visuales.uclv.cu/Cursos/DevOps%20Course/notes%20%23%20%2520.txt";
  await page.evaluate((url) => {
    window.testBridge.results = [
      {
        url,
        encodedUrl: url,
        text: "notes # %20.txt",
        directory: "/Cursos/DevOps Course",
        isDirectoryLink: false,
      },
    ];
    window.testBridge.tasks = [
      {
        ...window.testBridge.tasks[2],
        id: "encoded-task",
        url: "https://visuales.uclv.cu/Cursos/DevOps%20Course/",
        output: "/Downloads/literal%20folder",
        lastError: `Cannot fetch ${url}`,
      },
    ];
    window.testBridge.fileDetails["encoded-task"] = {
      version: 1,
      updatedAt: Date.now(),
      files: [
        {
          url,
          path: "notes # %20.txt",
          status: "failed",
          downloadedBytes: 0,
          totalBytes: 10,
          error: `Cannot fetch ${url}`,
        },
      ],
    };
  }, url);
  const input = page.getByRole("searchbox", { name: "Search library", exact: true });
  await input.fill("notes");
  await input.press("Enter");
  const row = page.getByRole("treeitem", { name: "notes # %20.txt", exact: true });
  await row.waitFor();
  assert.equal(await row.getAttribute("data-url"), url);
  await row.click();
  await page.waitForFunction(() => window.testBridge.calls.some((call) => call.command === "open_library_window"));
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.find((call) => call.command === "open_library_window").args.url),
    url
  );
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to Queue", exact: true }).click();
  await page.waitForFunction(() => window.testBridge.calls.some((call) => call.command === "start_download"));
  assert.deepEqual(
    await page.evaluate(() => window.testBridge.calls.find((call) => call.command === "start_download").args.urls),
    [url]
  );
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("button", { name: "Details for DevOps Course", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Transfer details" });
  await inspector.getByText("notes # %20.txt", { exact: true }).waitFor();
  assert.equal(await inspector.locator(".inspector-path").textContent(), "/Downloads/literal%20folder");
  await inspector
    .getByText("Cannot fetch https://visuales.uclv.cu/Cursos/DevOps Course/notes # %20.txt", { exact: true })
    .first()
    .waitFor();
  await inspector.getByRole("button", { name: "Open download folder", exact: true }).click();
  await page.waitForFunction(() => window.testBridge.calls.some((call) => call.command === "open_output_folder"));
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.find((call) => call.command === "open_output_folder").args.path),
    "/Downloads/literal%20folder"
  );
  await inspector.getByRole("button", { name: "Retry notes # %20.txt", exact: true }).click();
  await page.waitForFunction(() => window.testBridge.calls.some((call) => call.command === "retry_download_files"));
  assert.deepEqual(
    await page.evaluate(
      () => window.testBridge.calls.find((call) => call.command === "retry_download_files").args.paths
    ),
    ["notes # %20.txt"]
  );
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${screenshots}/decoded-transfer-paths.png` });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
}
