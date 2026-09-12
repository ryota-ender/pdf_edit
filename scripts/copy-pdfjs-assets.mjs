// Copies the runtime assets that pdf.js loads over HTTP into `public/pdfjs/`.
//
// The worker is served from a plain URL instead of being bundled so the setup
// works identically under Turbopack, webpack and `next start`. The cmaps and
// standard fonts are what let PDFs with CJK encodings render correctly.
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const outDir = path.join(process.cwd(), "public", "pdfjs");

const entries = [
  ["build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"],
  ["iccs", "iccs"],
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const [from, to] of entries) {
  await cp(path.join(pdfjsRoot, from), path.join(outDir, to), {
    recursive: true,
  });
}

console.log(`[pdfjs] copied ${entries.length} asset entries to public/pdfjs`);

// --- OCR (Tesseract) の資材 ------------------------------------------------
// すべて自分のドメインから配ることで、PDF の中身も認識結果も外へ出さない。
const ocrDir = path.join(process.cwd(), "public", "ocr");
await mkdir(ocrDir, { recursive: true });

const tesseractRoot = path.dirname(require.resolve("tesseract.js/package.json"));
const coreRoot = path.dirname(require.resolve("tesseract.js-core/package.json"));

// worker 本体と、SIMD の有無で選ばれる LSTM 版のコアだけを置く。
const ocrFiles = [
  [path.join(tesseractRoot, "dist", "worker.min.js"), "worker.min.js"],
  [path.join(coreRoot, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
  [path.join(coreRoot, "tesseract-core-lstm.wasm"), "tesseract-core-lstm.wasm"],
  [
    path.join(coreRoot, "tesseract-core-simd-lstm.wasm.js"),
    "tesseract-core-simd-lstm.wasm.js",
  ],
  [path.join(coreRoot, "tesseract-core-simd-lstm.wasm"), "tesseract-core-simd-lstm.wasm"],
];

for (const [from, to] of ocrFiles) {
  await cp(from, path.join(ocrDir, to));
}

// 学習データはリポジトリに入れず、初回インストール時に取得する。
const langDir = path.join(ocrDir, "lang");
await mkdir(langDir, { recursive: true });

for (const lang of ["jpn", "eng"]) {
  const target = path.join(langDir, `${lang}.traineddata`);
  try {
    await access(target);
    continue;
  } catch {
    // まだ無いので取得する。
  }

  const url = `https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await writeFile(target, new Uint8Array(await response.arrayBuffer()));
    console.log(`[ocr] downloaded ${lang}.traineddata`);
  } catch (error) {
    console.warn(
      `[ocr] ${lang}.traineddata を取得できませんでした（OCR は使えません）:`,
      error instanceof Error ? error.message : error,
    );
  }
}

console.log("[ocr] assets ready in public/ocr");
