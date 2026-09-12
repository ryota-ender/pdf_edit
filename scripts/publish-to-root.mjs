// 静的書き出し (out/) をリポジトリ直下へ配置する。
//
// GitHub Pages を「main ブランチの直下を配信」で使っているため、
// 直下に index.html が無いと README.md が代わりに表示される。
// そこで書き出した成果物をそのまま直下へ置き、それを commit する。
//
//   npm run deploy      # ビルドしてから配置
//   node scripts/publish-to-root.mjs
//
// 消すのは「前回ここが置いたもの」だけに限る。out/ に入っている名前と
// 同じ直下のエントリを消してから複製するので、ソースには触れない。
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "out");

let entries;
try {
  entries = await readdir(outDir);
} catch {
  console.error(
    "out/ がありません。先に `npm run build:pages` を実行してください。",
  );
  process.exit(1);
}

if (!entries.includes("index.html")) {
  console.error("out/index.html がありません。書き出しに失敗しています。");
  process.exit(1);
}

// 直下に置いてはいけないもの（ソースを壊さないための保険）。
const PROTECTED = new Set([
  ".git",
  ".gitignore",
  "node_modules",
  "public",
  "src",
  "scripts",
  "package.json",
  "package-lock.json",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "next.config.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  "postcss.config.mjs",
]);

for (const name of entries) {
  if (PROTECTED.has(name)) {
    console.error(`中止: out/${name} は直下の重要なファイルと衝突します。`);
    process.exit(1);
  }
}

for (const name of entries) {
  await rm(path.join(root, name), { recursive: true, force: true });
  await cp(path.join(outDir, name), path.join(root, name), { recursive: true });
}

// Jekyll は `_` で始まるディレクトリを配信しない。`_next/` が丸ごと
// 消えてしまうので、Jekyll の処理自体を止める。これが無いと真っ白になる。
await writeFile(path.join(root, ".nojekyll"), "");

console.log(`[publish] ${entries.length} 件を直下へ配置しました (+ .nojekyll)`);
