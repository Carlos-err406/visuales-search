import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../dist/lib/html-parser.js";

describe("parseHtml", () => {
  it("normalizes visuales links to https", () => {
    const html = `
      <a href="http://visuales.uclv.cu/Series/Ingles/">Ingles</a>
      <a href="http://visuales.uclv.cu/Series/Ingles/file.mp4">file.mp4</a>
    `;

    const results = parseHtml(html, []);

    assert.deepEqual(
      results.map((result) => result.url),
      ["https://visuales.uclv.cu/Series/Ingles/", "https://visuales.uclv.cu/Series/Ingles/file.mp4"]
    );
    assert.deepEqual(
      results.map((result) => result.encodedUrl),
      ["https://visuales.uclv.cu/Series/Ingles/", "https://visuales.uclv.cu/Series/Ingles/file.mp4"]
    );
  });

  it("does not change non-visuales hosts", () => {
    const html = '<a href="http://example.com/file.mp4">file.mp4</a>';

    const [result] = parseHtml(html, []);

    assert.equal(result.url, "http://example.com/file.mp4");
  });
});
