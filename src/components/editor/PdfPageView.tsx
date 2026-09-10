"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPageToCanvas } from "@/lib/pdf/renderPdf";
import { CSS_PX_PER_POINT } from "@/lib/pdf/coordinates";
import { elementRect, rectCenter } from "@/lib/pdf/geometry";
import { usePageInteraction } from "@/hooks/usePageInteraction";
import type { PageActions } from "@/hooks/usePageInteraction";
import type { StyleDefaults } from "@/lib/pdf/elementDefaults";
import { ElementView, elementCenter, penPathData } from "./ElementView";
import { SelectionLayer } from "./SelectionLayer";
import { InlineTextEditor } from "./InlineTextEditor";
import type { FontBook } from "@/lib/pdf/font";
import type { ImageAssetStore } from "@/lib/pdf/imageAssets";
import type {
  EditorElement,
  NormalizedRect,
  ToolId,
} from "@/types/editor";

interface PdfPageViewProps {
  doc: PDFDocumentProxy;
  pageIndex: number;
  sourceIndex: number;
  /** 元の /Rotate にエディタでの回転を加えた最終的な角度。 */
  rotation: number;
  /** 回転適用後のページ寸法（PDFポイント）。 */
  view: { width: number; height: number };
  zoom: number;
  elements: EditorElement[];
  selectedIds: string[];
  editingId: string | null;
  tool: ToolId;
  style: StyleDefaults;
  fonts: FontBook;
  images: ImageAssetStore;
  actions: PageActions;
  snapEnabled: boolean;
  /** 検索でヒットした箇所（このページ分）。 */
  searchRects: NormalizedRect[];
  activeSearchRects: NormalizedRect[];
  onPreviewText: (id: string, text: string) => void;
  onFinishEdit: (id: string, text: string) => void;
  onRenderError: (message: string) => void;
}

/** 掴みやすさのため、細い線には見た目より太い当たり判定を与える。 */
const HIT_PADDING_PX = 10;

export function PdfPageView({
  doc,
  pageIndex,
  sourceIndex,
  rotation,
  view,
  zoom,
  elements,
  selectedIds,
  editingId,
  tool,
  style,
  fonts,
  images,
  actions,
  snapEnabled,
  searchRects,
  activeSearchRects,
  onPreviewText,
  onFinishEdit,
  onRenderError,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);

  const cssPxPerPoint = zoom * CSS_PX_PER_POINT;
  const widthPx = view.width * cssPxPerPoint;
  const heightPx = view.height * cssPxPerPoint;

  const interaction = usePageInteraction({
    pageIndex,
    view,
    cssPxPerPoint,
    elements,
    selectedIds,
    tool,
    style,
    fonts,
    actions,
    svgRef,
    snapEnabled,
  });

  // --- 画面に入っているページだけ描画し、離れたら解放する -------------
  // ページ数の多い PDF でも、キャンバスのメモリが際限なく増えない。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!isVisible) {
      // 画面から遠ざかったらバッキングストアを手放す。
      // state の更新は次のフレームに回し、描画中の再入を避ける。
      canvas.width = 0;
      canvas.height = 0;
      const frame = requestAnimationFrame(() => setHasRendered(false));
      return () => cancelAnimationFrame(frame);
    }

    const render = renderPageToCanvas(doc, {
      canvas,
      sourceIndex,
      scale: cssPxPerPoint,
      rotation,
      pixelRatio: Math.min(2, globalThis.devicePixelRatio || 1),
    });

    render.done.then(
      () => setHasRendered(true),
      (error: unknown) => {
        setHasRendered(true);
        onRenderError(
          error instanceof Error
            ? `ページの表示に失敗しました。（${error.message}）`
            : "ページの表示に失敗しました。",
        );
      },
    );

    return render.cancel;
  }, [doc, sourceIndex, rotation, cssPxPerPoint, isVisible, onRenderError]);

  // --- 描画 -----------------------------------------------------------
  const measureCtx = { view, fonts };
  const selectedElements = elements.filter((element) =>
    selectedIds.includes(element.id),
  );
  const singleSelection =
    selectedElements.length === 1 ? selectedElements[0] : null;

  const selectionRect = computeSelectionRect(
    selectedElements,
    singleSelection,
    measureCtx,
  );
  const editingElement =
    elements.find((element) => element.id === editingId) ?? null;
  const hitPadding = HIT_PADDING_PX / cssPxPerPoint;

  const cursor =
    tool === "text"
      ? "text"
      : tool === "textEdit"
        ? "crosshair"
        : tool === "select"
          ? "default"
          : "crosshair";

  return (
    <div
      ref={containerRef}
      data-pdf-page
      data-page-index={pageIndex}
      className="relative bg-white shadow-[0_1px_2px_rgba(15,23,42,0.10),0_10px_30px_rgba(15,23,42,0.12)]"
      style={{ width: widthPx, height: heightPx }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full bg-white"
        style={{ width: widthPx, height: heightPx }}
      />

      {!hasRendered && (
        <div className="absolute inset-0 grid place-items-center bg-white">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-400" />
        </div>
      )}

      <svg
        ref={svgRef}
        data-edit-layer
        viewBox={`0 0 ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none", cursor }}
        onPointerDown={interaction.onBackgroundPointerDown}
        onPointerMove={interaction.onPointerMove}
        onPointerUp={interaction.onPointerUp}
        onPointerCancel={interaction.onPointerUp}
      >
        {/* 検索のヒット箇所。要素より下に敷く。 */}
        {searchRects.map((rect, index) => (
          <rect
            key={`hit-${index}`}
            x={rect.x * view.width}
            y={rect.y * view.height}
            width={rect.w * view.width}
            height={rect.h * view.height}
            fill="#facc15"
            fillOpacity={0.4}
            pointerEvents="none"
          />
        ))}
        {activeSearchRects.map((rect, index) => (
          <rect
            key={`active-${index}`}
            x={rect.x * view.width}
            y={rect.y * view.height}
            width={rect.w * view.width}
            height={rect.h * view.height}
            fill="#fb923c"
            fillOpacity={0.65}
            pointerEvents="none"
          />
        ))}

        {elements.map((element) => (
          <ElementView
            key={element.id}
            element={element}
            view={view}
            fonts={fonts}
            images={images}
            isEditing={element.id === editingId}
          />
        ))}

        {elements.map((element) => (
          <ElementHitArea
            key={`hit-${element.id}`}
            element={element}
            view={view}
            fonts={fonts}
            padding={hitPadding}
            disabled={element.id === editingId || element.locked}
            onPointerDown={(event) =>
              interaction.onElementPointerDown(event, element)
            }
            onDoubleClick={() => {
              if (element.type === "text" && !element.locked) {
                actions.startEditing(element.id);
              }
            }}
          />
        ))}

        {selectionRect && !editingElement && (
          <SelectionLayer
            rect={selectionRect}
            element={singleSelection}
            rotation={singleSelection?.rotation ?? 0}
            center={
              singleSelection
                ? elementCenter(singleSelection, view, fonts)
                : { x: 0, y: 0 }
            }
            view={view}
            cssPxPerPoint={cssPxPerPoint}
            onHandlePointerDown={interaction.onHandlePointerDown}
          />
        )}

        {/* スナップの目安線。 */}
        {interaction.guides.map((guide, index) => (
          <line
            key={`guide-${index}`}
            x1={guide.axis === "x" ? guide.position * view.width : 0}
            y1={guide.axis === "x" ? 0 : guide.position * view.height}
            x2={guide.axis === "x" ? guide.position * view.width : view.width}
            y2={guide.axis === "x" ? view.height : guide.position * view.height}
            stroke="#ec4899"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}

        {interaction.marquee && (
          <rect
            x={interaction.marquee.x * view.width}
            y={interaction.marquee.y * view.height}
            width={interaction.marquee.w * view.width}
            height={interaction.marquee.h * view.height}
            fill={tool === "textEdit" ? "#f59e0b" : "#2563eb"}
            fillOpacity={0.1}
            stroke={tool === "textEdit" ? "#f59e0b" : "#2563eb"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </svg>

      {editingElement && editingElement.type === "text" && (
        <InlineTextEditor
          key={editingElement.id}
          element={editingElement}
          view={view}
          cssPxPerPoint={cssPxPerPoint}
          fonts={fonts}
          onPreview={(text) => onPreviewText(editingElement.id, text)}
          onFinish={(text) => onFinishEdit(editingElement.id, text)}
        />
      )}
    </div>
  );
}

function computeSelectionRect(
  selected: EditorElement[],
  single: EditorElement | null,
  ctx: { view: { width: number; height: number }; fonts: FontBook },
): NormalizedRect | null {
  if (selected.length === 0) return null;

  // 単一選択なら要素そのものの枠（回転前）。枠ごと回して見せる。
  if (single) return elementRect(single, ctx);

  // 複数選択は軸に平行な外接矩形。
  const rects = selected.map((element) => elementRect(element, ctx));
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((rect) => rect.x + rect.w)) - x,
    h: Math.max(...rects.map((rect) => rect.y + rect.h)) - y,
  };
}

interface ElementHitAreaProps {
  element: EditorElement;
  view: { width: number; height: number };
  fonts: FontBook;
  padding: number;
  disabled: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  onDoubleClick: () => void;
}

/**
 * 要素を掴むための透明な当たり判定。
 * 線や文字は塗りが薄いので、見た目そのものではなく専用の図形を重ねる。
 */
function ElementHitArea({
  element,
  view,
  fonts,
  padding,
  disabled,
  onPointerDown,
  onDoubleClick,
}: ElementHitAreaProps) {
  const common = {
    pointerEvents: (disabled ? "none" : "all") as "none" | "all",
    style: { cursor: disabled ? "default" : "move" },
    onPointerDown,
    onDoubleClick,
  };

  const shape = (() => {
    if (element.type === "arrow") {
      return (
        <line
          fill="none"
          x1={element.x1 * view.width}
          y1={element.y1 * view.height}
          x2={element.x2 * view.width}
          y2={element.y2 * view.height}
          stroke="transparent"
          strokeWidth={Math.max(element.strokeWidth, padding)}
          strokeLinecap="round"
          {...common}
        />
      );
    }

    if (element.type === "pen") {
      if (element.points.length < 2) return null;
      return (
        <path
          d={penPathData(element.points, view)}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(element.strokeWidth, padding)}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...common}
        />
      );
    }

    const rect = elementRect(element, { view, fonts });
    return (
      <rect
        fill="transparent"
        x={rect.x * view.width}
        y={rect.y * view.height}
        width={Math.max(rect.w * view.width, padding)}
        height={Math.max(rect.h * view.height, padding)}
        {...common}
      />
    );
  })();

  if (!shape) return null;
  if (element.rotation === 0) return shape;

  const center = rectCenter(elementRect(element, { view, fonts }));
  return (
    <g
      transform={`rotate(${element.rotation} ${center.x * view.width} ${
        center.y * view.height
      })`}
    >
      {shape}
    </g>
  );
}
