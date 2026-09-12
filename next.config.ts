import type { NextConfig } from "next";

/*
 * GitHub Pages 向けの静的書き出し
 * ------------------------------------------------------------------
 * このアプリはサーバー処理を一切持たないので、そのまま静的サイトとして
 * 配信できる。プロジェクトページは `https://<user>.github.io/pdf_edit/` の
 * ように下の階層で配信されるため、`NEXT_PUBLIC_BASE_PATH` にその接頭辞を
 * 渡してビルドする（`npm run build:pages`）。
 *
 * 接頭辞が無いときは従来どおり `next build` → `next start` で動く。
 * E2E はこちらで回している。
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

const nextConfig: NextConfig = basePath
  ? { output: "export", basePath, trailingSlash: true }
  : {};

export default nextConfig;
