import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getQueuePosition, isQueuedTaskReady } from "../dist/commands/download/tasks.js";

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
