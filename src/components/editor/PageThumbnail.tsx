"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPageToCanvas } from "@/lib/pdf/renderPdf";
import type { PageSize } from "@/types/editor";

const THUMBNAIL_WIDTH = 132;

interface PageThumbnailProps {
  doc: PDFDocumentProxy;
  sourceIndex: number;
  /** 回転を適用していない元のページ寸法。 */
  size: PageSize;
  /** 元の /Rotate にエディタでの回転を加えた最終的な角度。 */
  rotation: number;
}

/**
 * サムネイル 1 枚。
 * 画面に入るまで描画しない。ページ数の多い PDF を開いた瞬間に全ページを
 * ラスタライズしてしまうのを避けるため。
 */
export function PageThumbnail({
  doc,
  sourceIndex,
  size,
  rotation,
}: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);

  const swapped = ((rotation % 360) + 360) % 360 % 180 === 90;
  const viewWidth = swapped ? size.height : size.width;
  const viewHeight = swapped ? size.width : size.height;
  const displayHeight = Math.round((THUMBNAIL_WIDTH * viewHeight) / viewWidth);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || isVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { root: element.closest("[data-thumbnail-scroll]"), rootMargin: "200px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isVisible || !canvas) return;

    const render = renderPageToCanvas(doc, {
      canvas,
      sourceIndex,
      scale: THUMBNAIL_WIDTH / viewWidth,
      rotation,
      pixelRatio: Math.min(2, globalThis.devicePixelRatio || 1),
    });

    render.done.then(
      () => setHasRendered(true),
      () => {
        // サムネイルが 1 枚描けなくても編集は続けられるので、
        // プレースホルダーのまま黙って諦める。
      },
    );

    return render.cancel;
  }, [doc, isVisible, rotation, sourceIndex, viewWidth]);

  return (
    <div
      ref={containerRef}
      className="relative bg-white"
      style={{ width: THUMBNAIL_WIDTH, height: displayHeight }}
    >
      <canvas
        ref={canvasRef}
        className={`block h-full w-full transition-opacity ${
          hasRendered ? "opacity-100" : "opacity-0"
        }`}
      />
      {!hasRendered && (
        <div className="absolute inset-0 animate-pulse bg-slate-100" />
      )}
    </div>
  );
}
