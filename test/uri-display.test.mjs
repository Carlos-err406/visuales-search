import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeUriForDisplay, urlPathForDisplay, messageForDisplay } from "../packages/core/dist/uri-display.js";
import { transferName } from "../packages/core/dist/download/transfer-summary.js";
import { buildSearchTree } from "../packages/core/dist/search-tree.js";
import { listingEntries } from "../packages/core/dist/library-listing.js";
import { parseHtml } from "../packages/core/dist/lib/html-parser.js";

const base = "https://visuales.uclv.cu/";

test("URI labels decode spaces, Unicode and reserved characters exactly once", () => {
  assert.equal(
    urlPathForDisplay(`${base}Cursos/DevOps%20Interview%20Preparation%20Course/4%20-%20Docker/`),
    "/Cursos/DevOps Interview Preparation Course/4 - Docker/"
  );
  const name = "Espa\u00f1ol #1? + & %20.txt";
  assert.equal(decodeUriForDisplay(encodeURIComponent(name)), name);
  assert.equal(decodeUriForDisplay("one+two%20three"), "one+two three");
  assert.equal(
    urlPathForDisplay("file:///Users/me/Example%20Folder/100%2520.txt"),
    "/Users/me/Example Folder/100%20.txt"
  );
  assert.equal(decodeUriForDisplay("%3Cscript%3Ealert(1)%3C%2Fscript%3E"), "<script>alert(1)</script>");
});

test("malformed and legacy escapes never prevent neighboring URI characters from displaying", () => {
  assert.equal(decodeUriForDisplay("100% ready%20now%ZZ%2"), "100% ready now%ZZ%2");
  assert.equal(decodeUriForDisplay("Espa%F1ol%20%26%20caf%C3%A9"), "Espa\u00f1ol & caf\u00e9");
  assert.equal(decodeUriForDisplay("%F1%C3%A9"), "\u00f1\u00e9");
  assert.equal(urlPathForDisplay("/not%20a%20URL/%broken%20path"), "/not a URL/%broken path");
});

test("diagnostics decode URI spans, leaving literal local paths and message text alone", () => {
  assert.equal(
    messageForDisplay(
      'Cannot fetch "https://visuales.uclv.cu/Part%201/notes%23one.txt" into /Downloads/literal%20name'
    ),
    'Cannot fetch "https://visuales.uclv.cu/Part 1/notes#one.txt" into /Downloads/literal%20name'
  );
  assert.equal(
    messageForDisplay("Open file:///Users/me/Part%201 then app://preview/Part%202"),
    "Open file:///Users/me/Part 1 then app://preview/Part 2"
  );
  assert.equal(messageForDisplay("A literal %20, 50% complete"), "A literal %20, 50% complete");
  assert.equal(messageForDisplay(undefined), "");
});

test("shared download, tray and notification names are readable without changing the task", () => {
  const task = { url: `${base}Espa%F1ol%20%23%20100%25/`, urls: ["first", "second"] };
  const before = structuredClone(task);
  assert.equal(transferName(task), "Espa\u00f1ol # 100% + 1 more");
  assert.deepEqual(task, before);
  assert.equal(transferName({ url: `${base}literal%2520name/` }), "literal%20name");
});

test("listing paths and search rows decode URL data but not already-readable names", () => {
  const root = `${base}Part%201/`;
  const entries = listingEntries(root, {
    dirs: [`${root}Espa%F1ol%20%23/`],
    files: [{ url: `${root}literal%2520name.txt`, size: 12 }],
  });
  assert.equal(entries[0].text, "Espa\u00f1ol #");
  assert.equal(entries[0].directory, "/Part 1/Espa\u00f1ol #");
  assert.equal(entries[1].text, "literal%20name.txt");
  assert.equal(entries[1].encodedUrl, `${root}literal%2520name.txt`);
  const tree = buildSearchTree(entries);
  assert.equal(tree[0].name, "Part 1");
  assert.equal(tree[0].children[1].name, "literal%20name.txt");
  assert.equal(tree[0].children[1].url, entries[1].encodedUrl);
  const encodedLabel = { ...entries[1], text: "literal%2520name.txt" };
  assert.equal(buildSearchTree([encodedLabel])[0].children[0].name, "literal%20name.txt");
});

test("listado anchor labels only decode when the label is the encoded URL basename", () => {
  const [encoded, literal] = parseHtml(
    `<a href="${base}Course%20%231/">Course%20%231</a>
     <a href="${base}literal%2520name.txt">literal%20name.txt</a>`,
    []
  );
  assert.equal(encoded.text, "Course #1");
  assert.equal(encoded.encodedUrl, `${base}Course%20%231/`);
  assert.equal(literal.text, "literal%20name.txt");
  assert.equal(literal.encodedUrl, `${base}literal%2520name.txt`);
});
