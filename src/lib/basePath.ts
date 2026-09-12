/**
 * 配信元のパス接頭辞
 * ------------------------------------------------------------------
 * GitHub Pages のプロジェクトページのように、サイトの根ではなく
 * `/pdf_edit/` のような下の階層で配信されることがある。
 *
 * Next.js の `basePath` は `<Link>` や生成される `_next/` の URL は
 * 面倒を見てくれるが、`fetch("/fonts/...")` のように**コード中へ直接書いた
 * 絶対パス**までは書き換えない。フォント・PDF.js の worker・OCR の学習データは
 * すべてその形で読んでいるので、ここを通して組み立てる。
 *
 * 値はビルド時に埋め込まれる。指定が無ければ従来どおり根からの配信になる。
 */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

/** `public/` に置いた資材の URL を作る。引数は先頭 `/` 始まり。 */
export function assetUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}

export { BASE_PATH };
