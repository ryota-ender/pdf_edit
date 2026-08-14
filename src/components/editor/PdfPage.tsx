"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPageToCanvas } from "@/lib/pdf/renderPdf";
import { CSS_PX_PER_POINT, clamp } from "@/lib/pdf/coordinates";
import { layoutTextBlock } from "@/lib/pdf/textLayout";
import { TextElementView } from "./TextElementView";
import { InlineTextEditor } from "./InlineTextEditor";
import type { LoadedFont } from "@/lib/pdf/font";
import type { TextElement, ToolId } from "@/types/editor";

interface PdfPageProps {
  doc: PDFDocumentProxy;
  /** 元 PDF における 0 始まりのページ番号。 */
  sourceIndex: number;
  /** 元の /Rotate にエディタでの回転を加えた最終的な角度。 */
  rotation: number;
  /** 回転を適用した後のページ寸法 (ポイント)。 */
  viewWidth: number;
  viewHeight: number;
  zoom: number;
  elements: TextElement[];
  selectedId: string | null;
  editingId: string | null;
  tool: ToolId;
  font: LoadedFont;
  onAddText: (normalizedX: number, normalizedY: number) => void;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onMoveStart: () => void;
  onMove: (id: string, normalizedX: number, normalizedY: number) => void;
  onMoveEnd: () => void;
  onPreviewText: (id: string, text: string) => void;
  onFinishEdit: (id: string, text: string) => void;
  onRenderError: (message: string) => void;
}

interface DragState {
  id: string;
  pointerId: number;
  /** ドラッグ開始時のポインタ位置と要素位置の差 (ビュー座標)。 */
  offsetX: number;
  offsetY: number;
  /** 要素の左上が取りうる最大値 (ページ内に収める)。 */
  maxX: number;
  maxY: number;
  moved: boolean;
}

export function PdfPage({
  doc,
  sourceIndex,
  rotation,
  viewWidth,
  viewHeight,
  zoom,
  elements,
  selectedId,
  editingId,
  tool,
  font,
  onAddText,
  onSelect,
  onStartEdit,
  onMoveStart,
  onMove,
  onMoveEnd,
  onPreviewText,
  onFinishEdit,
  onRenderError,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  const cssPxPerPoint = zoom * CSS_PX_PER_POINT;
  const widthPx = viewWidth * cssPxPerPoint;
  const heightPx = viewHeight * cssPxPerPoint;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsRendering(true);
    const render = renderPageToCanvas(doc, {
      canvas,
      sourceIndex,
      scale: cssPxPerPoint,
      rotation,
      // 高 DPI 画面でも滲まないように。倍率が高すぎるとメモリを食うので上限を設ける。
      pixelRatio: Math.min(2, globalThis.devicePixelRatio || 1),
    });

    render.done.then(
      () => setIsRendering(false),
      (error: unknown) => {
        setIsRendering(false);
        onRenderError(
          error instanceof Error
            ? `ページの表示に失敗しました。（${error.message}）`
            : "ページの表示に失敗しました。",
        );
      },
    );

    return render.cancel;
  }, [doc, sourceIndex, rotation, cssPxPerPoint, onRenderError]);

  /** ポインタ位置をビュー座標 (ポイント) へ変換する。 */
  const toViewPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * viewWidth,
        y: ((event.clientY - rect.top) / rect.height) * viewHeight,
      };
    },
    [viewWidth, viewHeight],
  );

  const handleBackgroundPointerDown = (event: React.PointerEvent) => {
    // 要素側で stopPropagation しているので、ここに来るのは余白のクリックのみ。
    if (event.button !== 0) return;

    if (tool === "text") {
      const point = toViewPoint(event);
      onAddText(
        clamp(point.x / viewWidth, 0, 1),
        clamp(point.y / viewHeight, 0, 1),
      );
      return;
    }
    onSelect(null);
  };

  const handleElementPointerDown = (
    event: React.PointerEvent<SVGRectElement>,
    element: TextElement,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;

    onSelect(element.id);

    const point = toViewPoint(event);
    const layout = layoutTextBlock(element.text, element.fontSize, font);

    dragRef.current = {
      id: element.id,
      pointerId: event.pointerId,
      offsetX: point.x - element.x * viewWidth,
      offsetY: point.y - element.y * viewHeight,
      // 要素全体がページ内に収まる範囲に制限する。ページ外へ完全に
      // 出てしまって見失うことがない。
      maxX: Math.max(0, viewWidth - layout.width),
      maxY: Math.max(0, viewHeight - layout.height),
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    onMoveStart();
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const point = toViewPoint(event);
    const nextX = clamp(point.x - drag.offsetX, 0, drag.maxX);
    const nextY = clamp(point.y - drag.offsetY, 0, drag.maxY);

    drag.moved = true;
    onMove(drag.id, nextX / viewWidth, nextY / viewHeight);
  };

  const endDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onMoveEnd();
  };

  const editingElement =
    elements.find((element) => element.id === editingId) ?? null;

  return (
    <div
      className="relative shadow-[0_1px_3px_rgba(15,23,42,0.12),0_8px_24px_rgba(15,23,42,0.10)]"
      style={{ width: widthPx, height: heightPx }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full bg-white"
      />

      {isRendering && (
        <div className="absolute inset-0 grid place-items-center bg-white">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-400" />
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="none"
        className={`absolute inset-0 h-full w-full ${
          tool === "text" ? "cursor-text" : "cursor-default"
        }`}
        style={{ touchAction: "none" }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {elements.map((element) => (
          <TextElementView
            key={element.id}
            element={element}
            viewWidth={viewWidth}
            viewHeight={viewHeight}
            font={font}
            isSelected={element.id === selectedId}
            isEditing={element.id === editingId}
            onPointerDown={(event) => handleElementPointerDown(event, element)}
            onDoubleClick={() => onStartEdit(element.id)}
          />
        ))}
      </svg>

      {editingElement && (
        <InlineTextEditor
          key={editingElement.id}
          element={editingElement}
          viewWidth={viewWidth}
          viewHeight={viewHeight}
          cssPxPerPoint={cssPxPerPoint}
          font={font}
          onPreview={(text) => onPreviewText(editingElement.id, text)}
          onFinish={(text) => onFinishEdit(editingElement.id, text)}
        />
      )}
    </div>
  );
}
