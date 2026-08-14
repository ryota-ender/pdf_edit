// Copies the runtime assets that pdf.js loads over HTTP into `public/pdfjs/`.
//
// The worker is served from a plain URL instead of being bundled so the setup
// works identically under Turbopack, webpack and `next start`. The cmaps and
// standard fonts are what let PDFs with CJK encodings render correctly.
import { cp, mkdir, rm } from "node:fs/promises";
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
