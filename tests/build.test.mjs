import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages build uses portable relative assets", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>HydroRain/);
  assert.doesNotMatch(html, /(?:src|href)="\/assets\//);
  assert.doesNotMatch(html, /chatgpt/i);
});
