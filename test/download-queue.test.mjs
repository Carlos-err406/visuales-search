import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getQueuePosition, isQueuedTaskReady, selectDownloadWatchTasks } from "../dist/commands/download/tasks.js";

/**
 * Minimal task record for the queue-ordering logic. Only the fields the gate reads
 * (id, status, queuedAt/createdAt) matter here.
 */
function task(id, status, queuedAt) {
  return { id, status, queuedAt, createdAt: queuedAt };
}

describe("isQueuedTaskReady", () => {
  it("starts a lone queued task when nothing is running", () => {
    const tasks = [task("a", "queued", 1)];
    assert.equal(isQueuedTaskReady(tasks, "a"), true);
  });

  it("waits while another task is running", () => {
    const tasks = [task("run", "running", 0), task("a", "queued", 1)];
    assert.equal(isQueuedTaskReady(tasks, "a"), false);
  });

  it("lets the earliest queued task through first (FIFO)", () => {
    const tasks = [task("a", "queued", 1), task("b", "queued", 2)];
    assert.equal(isQueuedTaskReady(tasks, "a"), true);
    assert.equal(isQueuedTaskReady(tasks, "b"), false);
  });

  it("serializes the queue: only one waiter clears the gate at a time", () => {
    const tasks = [task("a", "queued", 1), task("b", "queued", 2), task("c", "queued", 3)];
    const ready = tasks.filter((t) => isQueuedTaskReady(tasks, t.id));
    assert.deepEqual(
      ready.map((t) => t.id),
      ["a"]
    );
  });

  it("breaks queuedAt ties by id so ordering is still deterministic", () => {
    const tasks = [task("z", "queued", 5), task("a", "queued", 5)];
    assert.equal(isQueuedTaskReady(tasks, "a"), true);
    assert.equal(isQueuedTaskReady(tasks, "z"), false);
  });

  it("ignores finished tasks — completed/failed/interrupted do not block the queue", () => {
    const tasks = [
      task("done", "completed", 0),
      task("boom", "failed", 0),
      task("stopped", "interrupted", 0),
      task("a", "queued", 1),
    ];
    assert.equal(isQueuedTaskReady(tasks, "a"), true);
  });

  it("is false for a task that is not queued", () => {
    const tasks = [task("a", "running", 1)];
    assert.equal(isQueuedTaskReady(tasks, "a"), false);
  });

  it("is false for an unknown task id", () => {
    assert.equal(isQueuedTaskReady([task("a", "queued", 1)], "missing"), false);
  });
});

describe("getQueuePosition", () => {
  it("reports how many tasks are running and queued ahead", () => {
    const tasks = [
      task("run1", "running", 0),
      task("run2", "running", 0),
      task("a", "queued", 1),
      task("b", "queued", 2),
    ];
    assert.deepEqual(getQueuePosition(tasks, "b"), { runningCount: 2, aheadCount: 1 });
    assert.deepEqual(getQueuePosition(tasks, "a"), { runningCount: 2, aheadCount: 0 });
  });
});

describe("selectDownloadWatchTasks", () => {
  it("keeps running tasks visible below newer queued tasks", () => {
    const tasks = [
      { ...task("queued-new", "queued", 30), updatedAt: 30 },
      { ...task("running-old", "running", 10), startedAt: 10, updatedAt: 10 },
      { ...task("queued-old", "queued", 20), updatedAt: 20 },
    ];

    const { visibleTasks, hiddenTasks } = selectDownloadWatchTasks(tasks, 12);

    assert.deepEqual(
      visibleTasks.map((t) => t.id),
      ["running-old"]
    );
    assert.deepEqual(
      hiddenTasks.map((t) => t.id),
      ["queued-old", "queued-new"]
    );
  });

  it("places running tasks at the bottom when there is room for queue context", () => {
    const tasks = [
      { ...task("queued-new", "queued", 30), updatedAt: 30 },
      { ...task("running-old", "running", 10), startedAt: 10, updatedAt: 10 },
      { ...task("queued-old", "queued", 20), updatedAt: 20 },
    ];

    const { visibleTasks, hiddenTasks } = selectDownloadWatchTasks(tasks, 22);

    assert.deepEqual(
      visibleTasks.map((t) => t.id),
      ["queued-old", "queued-new", "running-old"]
    );
    assert.deepEqual(hiddenTasks, []);
  });

  it("uses FIFO ordering for queued tasks", () => {
    const tasks = [
      { ...task("b", "queued", 2), updatedAt: 20 },
      { ...task("a", "queued", 1), updatedAt: 10 },
    ];

    const { visibleTasks } = selectDownloadWatchTasks(tasks);

    assert.deepEqual(
      visibleTasks.map((t) => t.id),
      ["a", "b"]
    );
  });

  it("shows every actionable task when the terminal height is unknown", () => {
    const tasks = [task("run", "running", 1), task("queued", "queued", 2), task("done", "completed", 3)];

    const { visibleTasks, hiddenTasks } = selectDownloadWatchTasks(tasks, undefined);

    assert.deepEqual(
      visibleTasks.map((t) => t.id),
      ["queued", "run"]
    );
    assert.deepEqual(hiddenTasks, []);
  });
});
