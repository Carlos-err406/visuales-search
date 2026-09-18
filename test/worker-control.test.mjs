import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setWorkerConcurrency } from "../apps/sidecar/dist/worker-control.js";

function worker() {
  const child = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null, connected: true, messages: [] });
  child.send = (message, callback) => {
    child.messages.push(message);
    callback();
  };
  return child;
}
function noListeners(child) {
  for (const event of ["message", "exit", "error"]) assert.equal(child.listenerCount(event), 0);
}

test("worker controls wait for their own acknowledgement and clean up listeners", async () => {
  const child = worker();
  let done = false;
  const pending = setWorkerConcurrency(child, 3).then(() => {
    done = true;
  });
  assert.equal(child.messages[0].concurrent, 3);
  child.emit("message", { type: "concurrency-updated", requestId: "unrelated" });
  await Promise.resolve();
  assert.equal(done, false, "delivery is not confirmation of applying the new limit");
  child.emit("message", { type: "concurrency-updated", requestId: child.messages[0].requestId });
  await pending;
  noListeners(child);
});

test("worker control errors and timeouts are surfaced and retryable", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const child = worker();
  const pending = setWorkerConcurrency(child, 3);
  const failure = assert.rejects(pending, /did not acknowledge/);
  t.mock.timers.tick(5000);
  await failure;
  noListeners(child);
  const retry = setWorkerConcurrency(child, 3);
  child.emit("message", { type: "concurrency-updated", requestId: child.messages[0].requestId });
  child.emit("message", {
    type: "concurrency-updated",
    requestId: child.messages[1].requestId,
    error: "Disk write failed",
  });
  await assert.rejects(retry, /Disk write failed/);
  noListeners(child);
});

test("worker exits are harmless; broken channels and send failures do not leak listeners", async () => {
  const child = worker();
  const pending = setWorkerConcurrency(child, 3);
  child.emit("exit", 0);
  await pending;
  noListeners(child);
  child.exitCode = 0;
  await setWorkerConcurrency(child, 3);
  assert.equal(child.messages.length, 1);
  child.exitCode = null;
  child.connected = false;
  await assert.rejects(setWorkerConcurrency(child, 3), /disconnected/);
  noListeners(child);
  child.connected = true;
  child.send = (_message, callback) => callback(new Error("Channel closed"));
  await assert.rejects(setWorkerConcurrency(child, 3), /Channel closed/);
  noListeners(child);
  child.send = () => {
    throw new Error("Send failed");
  };
  await assert.rejects(setWorkerConcurrency(child, 3), /Send failed/);
  noListeners(child);
});
