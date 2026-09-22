/* global window, document, Storage */
import assert from "node:assert/strict";

const downloadsKey = "visuales.download-groups";
const filesKey = "visuales.transfer-file-groups";

export async function testGroupState({ page, screenshots }) {
  const base = process.env.DESKTOP_URL || "http://127.0.0.1:1420/";
  const downloads = () => page.getByRole("tab", { name: /Downloads/ }).click();
  const group = (label) => page.getByRole("button", { name: new RegExp(`^${label} downloads`) });
  const expanded = async (control, value) => {
    await control.waitFor();
    await page.waitForFunction(
      ({ label, value }) => document.querySelector(`[aria-label="${label}"]`)?.getAttribute("aria-expanded") === value,
      { label: await control.getAttribute("aria-label"), value: String(value) }
    );
  };
  const stored = (key) => page.evaluate((key) => window.localStorage.getItem(key), key);
  await page.evaluate((keys) => keys.forEach((key) => window.localStorage.removeItem(key)), [downloadsKey, filesKey]);
  await page.goto(base);
  await downloads();
  await expanded(group("Finished"), true);
  await expanded(group("Error"), true);
  await expanded(group("Interrupted"), true);
  await group("Error").click();
  await expanded(group("Interrupted"), true);
  assert.ok(await page.getByRole("button", { name: "Details for Cosmos", exact: true }).isVisible());
  assert.equal(await page.locator("#download-group-failed .transfer-row").count(), 0);
  await group("Finished").click();
  await group("Pending").click();
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).click();
  await expanded(group("Finished"), false);
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await downloads();
  await expanded(group("Pending"), false);
  await expanded(group("Error"), false);
  await expanded(group("Interrupted"), true);
  await page.reload();
  await downloads();
  await expanded(group("Finished"), false);
  await expanded(group("Pending"), false);
  await page.evaluate(() => {
    window.testBridge.finished = window.testBridge.tasks.find((task) => task.status === "completed");
    window.testBridge.tasks = window.testBridge.tasks.filter((task) => task.status !== "completed");
  });
  await group("Finished").waitFor({ state: "detached" });
  await page.evaluate(() => window.testBridge.tasks.push(window.testBridge.finished));
  await expanded(group("Finished"), false);
  const savedDownloads = await stored(downloadsKey);

  await page.goto(`${base}?downloadTask=task-4`);
  await expanded(group("Finished"), true);
  assert.equal(await stored(downloadsKey), savedDownloads, "revealing a task does not overwrite preferences");
  await page.getByRole("searchbox", { name: "Filter downloads" }).fill("");
  await expanded(group("Finished"), false);
  await page.goto(`${base}?downloadTask=`);
  await expanded(group("Finished"), false);
  await page.getByRole("button", { name: "1 failed", exact: true }).click();
  await expanded(group("Downloading"), false);
  await expanded(group("Error"), true);
  await expanded(group("Interrupted"), false);
  assert.equal(await stored(downloadsKey), savedDownloads, "failure shortcut is temporary");
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await downloads();
  await expanded(group("Downloading"), true);
  await group("Error").click();

  const seedFiles = () =>
    page.evaluate(() => {
      const files = ["downloading", "waiting", "failed", "completed"].map((status) => ({
        path: `${status}.txt`,
        url: `https://example.test/${status}.txt`,
        status,
        downloadedBytes: status === "completed" ? 100 : 0,
        totalBytes: 100,
      }));
      for (const id of ["task-0", "task-2"])
        window.testBridge.fileDetails[id] = { version: 1, updatedAt: Date.now(), files };
    });
  const openInspector = () => page.getByRole("button", { name: "Details for Planet Earth II", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Transfer details" });
  const fileGroup = (label) => inspector.getByRole("button", { name: new RegExp(`^${label} files`) });
  await seedFiles();
  await openInspector();
  await expanded(fileGroup("Finished"), false);
  await fileGroup("Pending").click();
  assert.deepEqual(JSON.parse(await stored(filesKey)), { pending: true }, "contextual defaults are not persisted");
  await fileGroup("Finished").click();
  await inspector.getByRole("button", { name: "Close transfer details" }).click();
  await openInspector();
  await expanded(fileGroup("Pending"), false);
  await expanded(fileGroup("Finished"), true);
  await page
    .getByRole("button", { name: "Details for A very long documentary title with additional release details" })
    .click();
  await expanded(fileGroup("Pending"), false);
  await expanded(fileGroup("Finished"), true);
  await page.reload();
  await downloads();
  await seedFiles();
  await openInspector();
  await expanded(fileGroup("Finished"), true);
  await expanded(fileGroup("Pending"), false);
  await expanded(group("Finished"), false);
  await page.screenshot({ path: `${screenshots}/remembered-download-groups.png` });

  const other = await page.context().newPage();
  try {
    await other.goto(base);
    await other.evaluate(
      (key) => window.localStorage.setItem(key, JSON.stringify({ completed: false, queued: true })),
      downloadsKey
    );
    await expanded(group("Finished"), true);
    await expanded(group("Pending"), false);
    await expanded(fileGroup("Pending"), false);
    await other.evaluate((key) => window.localStorage.removeItem(key), downloadsKey);
    await expanded(group("Pending"), true);
  } finally {
    await other.close();
  }

  await page.evaluate(
    ([downloadsKey, filesKey]) => {
      window.localStorage.setItem(downloadsKey, "invalid JSON");
      window.localStorage.setItem(filesKey, "[]");
    },
    [downloadsKey, filesKey]
  );
  await page.reload();
  await downloads();
  await expanded(group("Finished"), true);
  await seedFiles();
  await openInspector();
  await expanded(fileGroup("Finished"), false);
  await page.evaluate(
    (key) => window.localStorage.setItem(key, JSON.stringify({ completed: "true", queued: true })),
    downloadsKey
  );
  await page.reload();
  await downloads();
  await expanded(group("Finished"), true);
  await expanded(group("Pending"), false);

  // Old combined preferences seed both new groups without overriding independent choices.
  await page.evaluate(
    ([downloadsKey, filesKey]) => {
      window.localStorage.setItem(downloadsKey, JSON.stringify({ attention: true, interrupted: false }));
      window.localStorage.setItem(filesKey, JSON.stringify({ attention: true }));
    },
    [downloadsKey, filesKey]
  );
  await page.reload();
  await downloads();
  await expanded(group("Error"), false);
  await expanded(group("Interrupted"), true);
  await group("Error").click();
  await group("Interrupted").click();
  await page.reload();
  await downloads();
  await expanded(group("Error"), true);
  await expanded(group("Interrupted"), false);
  await seedFiles();
  await page
    .getByRole("button", { name: "Details for A very long documentary title with additional release details" })
    .click();
  await expanded(fileGroup("Error"), false);
  await expanded(fileGroup("Interrupted"), false);
  await fileGroup("Interrupted").click();
  await expanded(fileGroup("Error"), false);
  await inspector.getByText("downloading.txt", { exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}/separate-error-interrupted-groups.png` });

  await page.addInitScript(
    ([downloadsKey, filesKey]) => {
      if (!new URL(window.location.href).searchParams.has("blockedGroupStorage")) return;
      for (const method of ["getItem", "setItem"]) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if ([downloadsKey, filesKey].includes(key)) throw new Error("Storage unavailable");
          return original.call(this, key, ...args);
        };
      }
    },
    [downloadsKey, filesKey]
  );
  await page.goto(`${base}?blockedGroupStorage=1`);
  await downloads();
  await expanded(group("Pending"), true);
  await group("Pending").click();
  await group("Finished").click();
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).click();
  await expanded(group("Pending"), false);
  await expanded(group("Finished"), false);
  await page.goto(base);
  await page.evaluate((keys) => keys.forEach((key) => window.localStorage.removeItem(key)), [downloadsKey, filesKey]);
}
