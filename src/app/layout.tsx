import type { Metadata } from "next";
import { assetUrl } from "@/lib/basePath";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Editor — ブラウザで完結するPDF編集",
  description:
    "PDFをサーバーへアップロードせず、ブラウザ内だけでテキストを追加・編集して書き出せるPDFエディタ。",
};

/*
 * PDF へ埋め込むのと同じ TTF をプレビューでも使う。
 * 同一フォント・同一メトリクスで描くことで、画面上の文字位置と
 * 書き出した PDF の文字位置が一致する。
 * `local()` は指定しない。利用者の環境にある同名フォントが使われると
 * 字形や字送りが変わってしまうため。
 *
 * globals.css ではなくここで書いているのは、配信元のパス接頭辞を
 * 差し込むため（`assetUrl`）。素の CSS ファイルでは組み立てられない。
 */
const fontFaceCss = `
@font-face {
  font-family: "NotoSansJPEmbedded";
  src: url("${assetUrl("/fonts/NotoSansJP-Regular.ttf")}") format("truetype");
  font-weight: 400;
  font-style: normal;
  /* 5MB あるので、読めるようになるまでは代替フォントで表示する。 */
  font-display: swap;
}

@font-face {
  font-family: "NotoSansJPEmbeddedBold";
  src: url("${assetUrl("/fonts/NotoSansJP-Bold.ttf")}") format("truetype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
