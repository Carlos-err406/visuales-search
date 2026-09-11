import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["apps/desktop/src/tray-view.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { selectTrayTasks, trayFilters } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const records = ["completed", "queued", "failed", "running", "interrupted"].map((status, i) => ({
  id: status,
  status,
  createdAt: i,
  updatedAt: i,
}));

test("tray filters include active queue and all historical statuses without mutating the store", () => {
  assert.deepEqual(
    selectTrayTasks(records, "active").map((task) => task.id),
    ["running", "queued"]
  );
  assert.equal(selectTrayTasks(records, "all").length, 5);
  for (const { value } of trayFilters.filter(({ value }) => !["active", "all"].includes(value))) {
    assert.deepEqual(
      selectTrayTasks(records, value).map((task) => task.id),
      [value]
    );
  }
  assert.equal(records[0].id, "completed");
  assert.deepEqual(selectTrayTasks([], "active"), []);
});

test("active ordering stays stable as progress updates, history is newest first", () => {
  assert.deepEqual(
    selectTrayTasks(records, "all").map((task) => task.id),
    ["running", "queued", "interrupted", "failed", "completed"]
  );
  const tasks = [
    { id: "a", status: "running", createdAt: 1, updatedAt: 100 },
    { id: "b", status: "running", createdAt: 2, updatedAt: 200 },
  ];
  assert.deepEqual(
    selectTrayTasks(tasks, "active").map((task) => task.id),
    ["a", "b"]
  );
  tasks[0].updatedAt = 300;
  assert.deepEqual(
    selectTrayTasks(tasks, "active").map((task) => task.id),
    ["a", "b"]
  );
});
