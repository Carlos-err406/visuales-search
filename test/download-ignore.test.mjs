import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import { setupDownloadCommand } from "../dist/commands/download/index.js";
import { createIgnoreMatcher, splitIgnoreRules } from "../packages/core/dist/download/ignore-rules.js";

const run = promisify(execFile);

test("ignore rules are ordered, including duplicate exclusions and nested exceptions", () => {
  const rules = createIgnoreMatcher(["*.jpg", "!poster.jpg"]);
  for (const name of ["poster.jpg", "nested/poster.jpg", "nested/POSTER.JPG"]) assert.equal(rules(name), false, name);
  for (const name of ["cover.jpg", "nested/cover.jpg"]) assert.equal(rules(name), true, name);
  assert.equal(createIgnoreMatcher(["*.jpg", "!poster.jpg", "*.jpg"])("poster.jpg"), true);
  assert.equal(createIgnoreMatcher(["*.jpg", "!nested/poster.jpg"])("nested/poster.jpg"), false);
  assert.equal(createIgnoreMatcher(["*.jpg", "!nested/poster.jpg"])("poster.jpg"), true);
  assert.equal(createIgnoreMatcher(["!poster.jpg"])("other.jpg"), false);
});

test("ignore rules support rooted paths, globstars, directory rules and parent reinclusion", () => {
  const root = createIgnoreMatcher(["/poster.jpg"]);
  assert.equal(root("poster.jpg"), true);
  assert.equal(root("nested/poster.jpg"), false);
  const globstar = createIgnoreMatcher(["**/cover[0-9].jpg"]);
  assert.equal(globstar("cover1.jpg"), true);
  assert.equal(globstar("a/b/cover2.jpg"), true);
  assert.equal(globstar("a/b/coverx.jpg"), false);
  const ignored = createIgnoreMatcher(["Extras/", "!Extras/poster.jpg"]);
  assert.equal(ignored("Extras/"), true);
  assert.equal(ignored("Extras/poster.jpg"), true, "excluded parent must be included first");
  const restored = createIgnoreMatcher(["Extras/", "!Extras/", "Extras/*", "!Extras/poster.jpg"]);
  assert.equal(restored("Extras/"), false);
  assert.equal(restored("Extras/poster.jpg"), false);
  assert.equal(restored("Extras/notes.txt"), true);
  assert.equal(createIgnoreMatcher(["Extras/"])("Extras"), false, "directory rules do not match a file");
});

test("comments, escapes and significant whitespace survive parsing", () => {
  assert.deepEqual(splitIgnoreRules(["# comment, not a rule\n*.jpg\n!poster.jpg\r\n"]), [
    "# comment, not a rule",
    "*.jpg",
    "!poster.jpg",
  ]);
  const match = createIgnoreMatcher([
    "# ignore nothing,*.txt",
    "\\#literal",
    "\\!literal",
    " leading",
    "trailing\\ ",
    "unescaped ",
  ]);
  assert.equal(match("readme.txt"), false);
  assert.equal(match("#literal"), true);
  assert.equal(match("!literal"), true);
  assert.equal(match(" leading"), true);
  assert.equal(match("leading"), false);
  assert.equal(match("trailing "), true);
  assert.equal(match("trailing"), false);
  assert.equal(match("unescaped"), true);
});

test("legacy comma/brace shorthand remains ordered and expansion is bounded", () => {
  const match = createIgnoreMatcher(["*.{jpg,nfo},*.srt,!poster.jpg"]);
  for (const file of ["cover.JPG", "nested/info.nfo", "film.srt"]) assert.equal(match(file), true);
  assert.equal(match("poster.jpg"), false);
  assert.equal(match("movie.mkv"), false);
  assert.equal(createIgnoreMatcher(["Extras/**"])("Extras\\notes.txt"), true);
  assert.equal(createIgnoreMatcher(["file\\,name.txt"])("file,name.txt"), true);
  assert.deepEqual(splitIgnoreRules(["[a,b].txt,*.jpg"]), ["[a,b].txt", "*.jpg"]);
  assert.throws(() => createIgnoreMatcher(["{1..2000}.jpg"]), /at most 1000/);
});

test("CLI collects repeatable and variadic ignore rules in argument order", async () => {
  const program = new Command();
  setupDownloadCommand(program);
  const command = program.commands.find((entry) => entry.name() === "download");
  let parsed;
  command.action((_urls, options) => {
    parsed = options;
  });
  await program.parseAsync(
    ["download", "https://example.test/", "--ignore", "*.jpg", "--ignore", "!poster.jpg", "*.nfo", "--ignore", "*.jpg"],
    { from: "user" }
  );
  assert.deepEqual(parsed.ignore, ["*.jpg", "!poster.jpg", "*.nfo", "*.jpg"]);
  await program.parseAsync(["download", "https://example.test/", "--ignore=*.txt", "--ignore=!readme.txt"], {
    from: "user",
  });
  assert.deepEqual(parsed.ignore, ["*.txt", "!readme.txt"], "reparsing does not retain old rules");
});

test("the distributed CLI rejects --exclude and only advertises --ignore", async () => {
  const { stdout } = await run(process.execPath, ["dist/cli.js", "download", "--help"]);
  assert.match(stdout, /--ignore/);
  assert.doesNotMatch(stdout, /--exclude/);
  await assert.rejects(
    run(process.execPath, ["dist/cli.js", "download", "https://example.test/", "--exclude", "*.jpg"]),
    (error) => error.code !== 0 && /unknown option '--exclude'/.test(error.stderr)
  );
});

test(
  "distributed CLI applies ordered rules to single and batch folder discovery and downloads",
  { timeout: 60000 },
  async (t) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-ignore-"));
    const body = Buffer.from("ignore fixture\n");
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push(req.url);
      if (req.url.endsWith("/")) {
        const names = req.url.endsWith("/nested/")
          ? ["poster.jpg", "cover.jpg", "root.txt"]
          : ["poster.jpg", "cover.jpg", "root.txt", "keep.txt", "nested/", "ignored/"];
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<pre>${names.map((name) => `<a href="${name}">${name}</a> 08-Sep-2026 12:00 ${name.endsWith("/") ? "-" : body.length}`).join("\n")}</pre>`
        );
      } else {
        res.writeHead(200, { "content-length": body.length });
        res.end(req.method === "HEAD" ? undefined : body);
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(home, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const batch of [false, true]) {
      const output = path.join(home, batch ? "batch" : "single");
      const urls = batch ? [`${base}/Pack/`, `${base}/Other/`] : [`${base}/Pack/`];
      const { stdout } = await run(
        process.execPath,
        [
          "dist/cli.js",
          "download",
          ...urls,
          "--output",
          output,
          "--compact",
          "--queue",
          "--ignore",
          "*.jpg",
          "--ignore",
          "!poster.jpg",
          "--ignore",
          "poster.jpg",
          "--ignore",
          "!nested/poster.jpg",
          "--ignore",
          "/root.txt",
          "--ignore",
          "ignored/",
        ],
        {
          env: { ...process.env, HOME: home, USERPROFILE: home },
          timeout: 25000,
        }
      );
      assert.match(stdout, new RegExp(`${batch ? 6 : 3} files`), "discovery counts match filtered files");
      for (const dir of batch ? ["Pack", "Other"] : [""]) {
        for (const file of ["keep.txt", "nested/poster.jpg", "nested/root.txt"])
          assert.deepEqual(await fs.readFile(path.join(output, dir, file)), body);
        for (const file of ["poster.jpg", "cover.jpg", "root.txt", "nested/cover.jpg", "ignored"])
          await assert.rejects(fs.access(path.join(output, dir, file)));
      }
    }

    const tasksPath = path.join(home, ".visuales-cli-cache", "download", "tasks.json");
    const store = JSON.parse(await fs.readFile(tasksPath, "utf8"));
    const resumable = store.tasks.find((task) => task.output === path.join(home, "batch"));
    const expectedRules = ["*.jpg", "!poster.jpg", "poster.jpg", "!nested/poster.jpg", "/root.txt", "ignored/"];
    assert.deepEqual(resumable.options.exclude, expectedRules);
    resumable.status = "interrupted";
    await fs.writeFile(tasksPath, JSON.stringify(store));
    await fs.rm(resumable.output, { recursive: true, force: true });
    const childOptions = { env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 20000 };
    let completed = false;
    try {
      await run(process.execPath, ["dist/cli.js", "tasks", "resume", resumable.id, "--detach"], childOptions);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const current = JSON.parse(await fs.readFile(tasksPath, "utf8")).tasks.find((task) => task.id === resumable.id);
        assert.notEqual(current.status, "failed", current.lastError);
        if (current.status === "completed") {
          assert.deepEqual(current.options.exclude, expectedRules, "detached resumes retain saved rule order");
          completed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(completed, true, "detached resume completes with the supported --ignore flag");
      for (const dir of ["Pack", "Other"]) {
        assert.deepEqual(await fs.readFile(path.join(resumable.output, dir, "nested/poster.jpg")), body);
        await assert.rejects(fs.access(path.join(resumable.output, dir, "cover.jpg")));
        await assert.rejects(fs.access(path.join(resumable.output, dir, "root.txt")));
      }
    } finally {
      if (!completed) await run(process.execPath, ["dist/cli.js", "tasks", "cancel", resumable.id], childOptions);
    }
    assert.equal(
      requests.some((url) => url.includes("/ignored/")),
      false,
      "ignored directories are not scanned"
    );
    assert.equal(
      requests.some((url) => url.endsWith("/cover.jpg")),
      false,
      "ignored files are not fetched"
    );
  }
);
