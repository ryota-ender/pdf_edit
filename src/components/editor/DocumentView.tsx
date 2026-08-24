"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface DocumentViewProps {
  /** 表示できる領域の幅・高さ（CSSピクセル）。fit 系のズーム計算に使う。 */
  onViewportResize: (size: { width: number; height: number }) => void;
  /** 画面中央に最も近いページ。ヘッダーのページ番号に反映する。 */
  onVisiblePageChange: (pageIndex: number) => void;
  /** ページ番号 → その位置までスクロールする関数を親へ渡す。 */
  registerScrollToPage: (scrollTo: (pageIndex: number) => void) => void;
  /** Ctrl/Cmd + ホイールでのズーム。 */
  onZoomGesture: (delta: number) => void;
  children: ReactNode;
}

/**
 * ページを縦に並べて流し読みできるスクロール領域。
 *
 * 1 ページずつ切り替えるのではなく全ページを連続表示することで、
 * 一般的な PDF ビューアと同じ操作感になる。実際の描画は各ページが
 * 画面に入ったときだけ行われる（PdfPageView 側の IntersectionObserver）。
 */
export function DocumentView({
  onViewportResize,
  onVisiblePageChange,
  registerScrollToPage,
  onZoomGesture,
  children,
}: DocumentViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- 表示領域の寸法を親へ伝える --------------------------------------
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const report = () =>
      onViewportResize({
        width: element.clientWidth,
        height: element.clientHeight,
      });

    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onViewportResize]);

  // --- スクロール位置から「今見ているページ」を求める --------------------
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let frame = 0;
    const handleScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const viewportMiddle = element.scrollTop + element.clientHeight / 2;
        const pages = element.querySelectorAll<HTMLElement>("[data-pdf-page]");

        let best = 0;
        let bestDistance = Infinity;
        for (const page of pages) {
          const middle = page.offsetTop + page.offsetHeight / 2;
          const distance = Math.abs(middle - viewportMiddle);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = Number(page.dataset.pageIndex ?? 0);
          }
        }
        onVisiblePageChange(best);
      });
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      element.removeEventListener("scroll", handleScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onVisiblePageChange]);

  // --- ページ送り用のスクロール関数を親へ渡す ---------------------------
  const scrollToPage = useCallback((pageIndex: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const target = element.querySelector<HTMLElement>(
      `[data-page-index="${pageIndex}"]`,
    );
    if (!target) return;
    element.scrollTo({ top: target.offsetTop - 24, behavior: "smooth" });
  }, []);

  useEffect(() => {
    registerScrollToPage(scrollToPage);
  }, [registerScrollToPage, scrollToPage]);

  // --- Ctrl/Cmd + ホイールでズーム --------------------------------------
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // ブラウザ自体のページズームを止めて、PDF の表示倍率だけ変える。
      event.preventDefault();
      onZoomGesture(-event.deltaY);
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [onZoomGesture]);

  return (
    <main
      ref={scrollRef}
      className="thin-scrollbar relative flex-1 overflow-auto bg-canvas"
    >
      <div className="flex w-fit min-w-full flex-col items-center gap-6 px-6 py-6">
        {children}
      </div>
    </main>
  );
}
