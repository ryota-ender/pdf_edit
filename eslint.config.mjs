import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // scripts/copy-pdfjs-assets.mjs が node_modules から複製・取得する配布物。
    "public/pdfjs/**",
    "public/ocr/**",
    // scripts/publish-to-root.mjs が直下へ置く静的書き出し（GitHub Pages 用）。
    // ソースではなくビルド成果物なので検査の対象外。
    "_next/**",
    "_not-found/**",
    "404/**",
    "pdfjs/**",
    "ocr/**",
  ]),
]);

export default eslintConfig;
