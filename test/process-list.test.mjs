import assert from "node:assert/strict";
import { test } from "node:test";
import { getProcessRows } from "../packages/core/dist/lib/process-list.js";

test("Windows process lookup uses native CIM JSON, not Unix ps", () => {
  const command = '"C:\\Program Files\\nodejs\\node.exe" cli.js download "https://example.test/El ni\u00f1o (2026)/"';
  const execute = (file, args, options) => {
    assert.match(file, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
    assert.ok(args.includes("-NoProfile"));
    assert.ok(args.includes("-NonInteractive"));
    assert.match(args.at(-1), /Get-CimInstance -ClassName Win32_Process/);
    assert.doesNotMatch(args.at(-1), /example\.test/);
    assert.equal(options.windowsHide, true);
    assert.equal(options.stdio, "pipe");
    assert.equal(options.encoding, "utf8");
    assert.ok(options.timeout > 0);
    return JSON.stringify([
      { ProcessId: 123, CommandLine: command },
      { ProcessId: 0, CommandLine: null },
    ]);
  };
  for (let i = 0; i < 2; i++) assert.deepEqual(getProcessRows("win32", execute), [{ pid: 123, command }]);
});

test("Windows lookup handles single-process, empty, inaccessible, and malformed output", () => {
  assert.deepEqual(
    getProcessRows("win32", () => JSON.stringify({ ProcessId: 1, CommandLine: "node cli.js" })),
    [{ pid: 1, command: "node cli.js" }]
  );
  for (const output of [
    "",
    "null",
    "[]",
    "invalid json",
    JSON.stringify([
      { ProcessId: -1, CommandLine: "node" },
      { ProcessId: "12", CommandLine: "node" },
      { ProcessId: 12, CommandLine: null },
      { ProcessId: 13, CommandLine: "" },
    ]),
  ])
    assert.deepEqual(
      getProcessRows("win32", () => output),
      []
    );
  assert.deepEqual(
    getProcessRows("win32", () => {
      throw new Error("CIM unavailable");
    }),
    []
  );
});

test("macOS and Linux preserve full-width Unix process lookup", () => {
  for (const platform of ["darwin", "linux"]) {
    assert.deepEqual(
      getProcessRows(platform, (file, args) => {
        assert.equal(file, "ps");
        assert.deepEqual(args, ["-ww", "-axo", "pid=,command="]);
        return "  42 node cli.js download https://example.test/a\ninvalid\n";
      }),
      [{ pid: 42, command: "node cli.js download https://example.test/a" }]
    );
  }
});
