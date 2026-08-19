import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the complete PixelLock application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>PixelLock — Local Folder Image Compressor<\/title>/i);
  assert.match(html, /Smaller files\./);
  assert.match(html, /Every pixel stays\./);
  assert.match(html, /Convert Input to Output/);
  assert.match(html, /Local folder processing/);
  assert.match(html, /Choose Input folder/);
  assert.match(html, /Choose Output folder/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("removes the disposable starter preview", async () => {
  const [page, layout, client] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/ImageConverter.tsx", root), "utf8"),
  ]);
  assert.match(page, /ImageConverter/);
  assert.match(layout, /PixelLock/);
  assert.match(client, /processImage/);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});
