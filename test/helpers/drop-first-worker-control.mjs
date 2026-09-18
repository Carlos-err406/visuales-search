import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const spawn = childProcess.spawn;

// Loaded only by the isolated test sidecar. Keep the real worker running so a
// missing control acknowledgement cannot also suspend a task-store lock owner.
childProcess.spawn = function (...args) {
  const child = Reflect.apply(spawn, this, args);
  if (!args[1]?.includes("--worker")) return child;
  const send = child.send;
  child.send = function (...messages) {
    if (messages[0]?.type === "concurrency") {
      child.send = send;
      const callback = messages.at(-1);
      if (typeof callback === "function") setImmediate(() => callback(null));
      return true;
    }
    return Reflect.apply(send, this, messages);
  };
  return child;
};
syncBuiltinESMExports();
