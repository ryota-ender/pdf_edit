"use client";

import type { ReactNode } from "react";

interface PdfCanvasProps {
  children: ReactNode;
}

/**
 * 編集中のページを中央に置くスクロール領域。
 * ページがビューポートより小さいときは中央寄せ、大きいときはスクロールさせる。
 */
export function PdfCanvas({ children }: PdfCanvasProps) {
  return (
    <main className="thin-scrollbar flex-1 overflow-auto bg-canvas">
      <div className="flex min-h-full w-fit min-w-full justify-center p-6">
        <div className="my-auto">{children}</div>
      </div>
    </main>
  );
}
