import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Editor — ブラウザで完結するPDF編集",
  description:
    "PDFをサーバーへアップロードせず、ブラウザ内だけでテキストを追加・編集して書き出せるPDFエディタ。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
