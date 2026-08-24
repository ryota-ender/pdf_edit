"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPageToCanvas } from "@/lib/pdf/renderPdf";
import { CSS_PX_PER_POINT } from "@/lib/pdf/coordinates";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/pdf/textLayout";
import {
  applyResize,
  clampTranslation,
  elementRect,
  normalizeRect,
  rectsIntersect,
  resizeRect,
  translateElement,
  unionRect,
} from "@/lib/pdf/geometry";
import type { HandleId } from "@/lib/pdf/geometry";
import {
  createDrawElement,
  createTextElement,
  isDegenerate,
  updateDrawElement,
} from "@/lib/pdf/elementDefaults";
import type { StyleDefaults } from "@/lib/pdf/elementDefaults";
import { ElementView } from "./ElementView";
import { SelectionLayer } from "./SelectionLayer";
import { InlineTextEditor } from "./InlineTextEditor";
import type { LoadedFont } from "@/lib/pdf/font";
import type { ImageAssetStore } from "@/lib/pdf/imageAssets";
import type {
  EditorElement,
  NormalizedRect,
  ToolId,
} from "@/types/editor";
import { DRAW_TOOLS } from "@/types/editor";

/** 親（PdfEditor）が用意する操作。ページ側は状態を持たず、これを呼ぶだけ。 */
export interface PageActions {
  beginTransaction: () => void;
  endTransaction: () => void;
  updateElements: (
    updater: (elements: EditorElement[]) => EditorElement[],
    transient: boolean,
  ) => void;
  addElement: (element: EditorElement, transient: boolean) => void;
  removeElement: (id: string) => void;
  setSelection: (ids: string[]) => void;
  startEditing: (id: string) => void;
  previewText: (id: string, text: string) => void;
  finishEdit: (id: string, text: string) => void;
  requestImage: (pageIndex: number, x: number, y: number) => void;
  onRenderError: (message: string) => void;
}

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
  font: LoadedFont;
  images: ImageAssetStore;
  actions: PageActions;
}

type Interaction =
  | { kind: "idle" }
  | {
      kind: "marquee";
      pointerId: number;
      startX: number;
      startY: number;
      additive: boolean;
      baseSelection: string[];
    }
  | {
      kind: "move";
      pointerId: number;
      startX: number;
      startY: number;
      ids: string[];
      originals: Map<string, EditorElement>;
      unionBefore: NormalizedRect;
      moved: boolean;
    }
  | {
      kind: "resize";
      pointerId: number;
      handle: HandleId;
      id: string;
      original: EditorElement;
      rectBefore: NormalizedRect;
    }
  | {
      kind: "draw";
      pointerId: number;
      id: string;
      startX: number;
      startY: number;
    };

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
  font,
  images,
  actions,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction>({ kind: "idle" });

  const [isVisible, setIsVisible] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);
  const [marquee, setMarquee] = useState<NormalizedRect | null>(null);

  const cssPxPerPoint = zoom * CSS_PX_PER_POINT;
  const widthPx = view.width * cssPxPerPoint;
  const heightPx = view.height * cssPxPerPoint;

  // --- 画面に入ったページだけ描画する（連続スクロール用） ------------
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
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isVisible]);

  const { onRenderError } = actions;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isVisible || !canvas) return;

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

  // --- 座標変換 ------------------------------------------------------
  const toNormalized = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    },
    [],
  );

  const rectOf = useCallback(
    (element: EditorElement) => elementRect(element, view, font),
    [view, font],
  );

  // --- 背景（＝ページの余白）でのポインタ操作 --------------------------
  const handleBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const point = toNormalized(event);

    if (tool === "text") {
      // 既定のフォーカス移動を止める。これを許すと、直後に生成した
      // 入力欄からフォーカスが奪われて編集が即終了してしまう。
      event.preventDefault();
      const element = createTextElement(pageIndex, point.x, point.y, style);
      actions.addElement(element, false);
      actions.setSelection([element.id]);
      actions.startEditing(element.id);
      return;
    }

    if (tool === "image") {
      actions.requestImage(pageIndex, point.x, point.y);
      return;
    }

    if ((DRAW_TOOLS as readonly string[]).includes(tool)) {
      event.preventDefault();
      const element = createDrawElement(
        tool as (typeof DRAW_TOOLS)[number],
        pageIndex,
        point.x,
        point.y,
        style,
      );
      actions.beginTransaction();
      actions.addElement(element, true);
      actions.setSelection([]);
      interactionRef.current = {
        kind: "draw",
        pointerId: event.pointerId,
        id: element.id,
        startX: point.x,
        startY: point.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // 選択ツール: 範囲選択を始める。
    if (!event.shiftKey) actions.setSelection([]);
    interactionRef.current = {
      kind: "marquee",
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      additive: event.shiftKey,
      baseSelection: event.shiftKey ? selectedIds : [],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // --- 要素の掴み -----------------------------------------------------
  const handleElementPointerDown = (
    event: React.PointerEvent,
    element: EditorElement,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (tool !== "select") {
      // 描画ツール中は要素の上からでも描き始められるようにする。
      handleBackgroundPointerDown(event);
      return;
    }

    const isSelected = selectedIds.includes(element.id);
    let nextSelection: string[];

    if (event.shiftKey) {
      nextSelection = isSelected
        ? selectedIds.filter((id) => id !== element.id)
        : [...selectedIds, element.id];
    } else {
      nextSelection = isSelected ? selectedIds : [element.id];
    }
    actions.setSelection(nextSelection);

    // Shift クリックで選択を外した要素は動かさない。
    if (event.shiftKey && isSelected) return;

    const point = toNormalized(event);
    const originals = new Map(
      elements
        .filter((item) => nextSelection.includes(item.id))
        .map((item) => [item.id, item]),
    );
    const union = unionRect([...originals.values()].map(rectOf));
    if (!union) return;

    actions.beginTransaction();
    interactionRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      ids: [...originals.keys()],
      originals,
      unionBefore: union,
      moved: false,
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  const handleHandlePointerDown = (
    handle: HandleId,
    event: React.PointerEvent<SVGElement>,
  ) => {
    event.stopPropagation();
    if (event.button !== 0 || selectedIds.length !== 1) return;

    const element = elements.find((item) => item.id === selectedIds[0]);
    if (!element) return;

    actions.beginTransaction();
    interactionRef.current = {
      kind: "resize",
      pointerId: event.pointerId,
      handle,
      id: element.id,
      original: element,
      rectBefore: rectOf(element),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // --- ドラッグ中 -----------------------------------------------------
  const handlePointerMove = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    if (interaction.kind === "idle") return;
    if (interaction.pointerId !== event.pointerId) return;

    const point = toNormalized(event);

    switch (interaction.kind) {
      case "marquee": {
        setMarquee(
          normalizeRect(
            interaction.startX,
            interaction.startY,
            point.x,
            point.y,
          ),
        );
        break;
      }

      case "move": {
        let dx = point.x - interaction.startX;
        let dy = point.y - interaction.startY;
        // Shift で水平・垂直移動に固定する。
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const clamped = clampTranslation(interaction.unionBefore, dx, dy);
        interaction.moved = true;

        actions.updateElements(
          (items) =>
            items.map((item) => {
              const original = interaction.originals.get(item.id);
              return original
                ? translateElement(original, clamped.dx, clamped.dy)
                : item;
            }),
          true,
        );
        break;
      }

      case "resize": {
        const { original, rectBefore, handle } = interaction;

        // 矢印は端点そのものを動かす。
        if (handle === "start" || handle === "end") {
          if (original.type !== "arrow") break;
          const next =
            handle === "start"
              ? { ...original, x1: point.x, y1: point.y }
              : { ...original, x2: point.x, y2: point.y };
          actions.updateElements(
            (items) => items.map((item) => (item.id === original.id ? next : item)),
            true,
          );
          break;
        }

        const after = resizeRect(rectBefore, handle, point.x, point.y, {
          // テキストは幅と高さを個別に持たないため、常に比率を保って
          // フォントサイズを拡大縮小する。
          keepAspect: event.shiftKey || original.type === "text",
        });
        const next = applyResize(original, rectBefore, after, {
          min: MIN_FONT_SIZE,
          max: MAX_FONT_SIZE,
        });
        actions.updateElements(
          (items) => items.map((item) => (item.id === original.id ? next : item)),
          true,
        );
        break;
      }

      case "draw": {
        actions.updateElements(
          (items) =>
            items.map((item) =>
              item.id === interaction.id
                ? updateDrawElement(
                    item,
                    interaction.startX,
                    interaction.startY,
                    point.x,
                    point.y,
                    { constrain: event.shiftKey },
                  )
                : item,
            ),
          true,
        );
        break;
      }
    }
  };

  // --- ドラッグ終了 ---------------------------------------------------
  const endInteraction = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    if (interaction.kind === "idle") return;
    if (interaction.pointerId !== event.pointerId) return;
    interactionRef.current = { kind: "idle" };

    switch (interaction.kind) {
      case "marquee": {
        const area = marquee;
        setMarquee(null);
        if (!area || area.w < 0.004 || area.h < 0.004) break;

        const hits = elements
          .filter((element) => rectsIntersect(rectOf(element), area))
          .map((element) => element.id);
        const merged = interaction.additive
          ? [...new Set([...interaction.baseSelection, ...hits])]
          : hits;
        actions.setSelection(merged);
        break;
      }

      case "move":
        actions.endTransaction();
        break;

      case "resize":
        actions.endTransaction();
        break;

      case "draw": {
        const drawn = elements.find((item) => item.id === interaction.id);
        if (!drawn || isDegenerate(drawn)) {
          // 点をひとつ打っただけの図形は残さない。
          actions.removeElement(interaction.id);
          actions.endTransaction();
          break;
        }
        actions.endTransaction();
        actions.setSelection([drawn.id]);
        break;
      }
    }
  };

  // --- 描画 -----------------------------------------------------------
  const selectedElements = elements.filter((element) =>
    selectedIds.includes(element.id),
  );
  const selectionRect = unionRect(selectedElements.map(rectOf));
  const editingElement =
    elements.find((element) => element.id === editingId) ?? null;
  const hitPadding = HIT_PADDING_PX / cssPxPerPoint;

  const cursor =
    tool === "text"
      ? "text"
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
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        {elements.map((element) => (
          <ElementView
            key={element.id}
            element={element}
            view={view}
            font={font}
            images={images}
            isEditing={element.id === editingId}
          />
        ))}

        {elements.map((element) => (
          <ElementHitArea
            key={`hit-${element.id}`}
            element={element}
            rect={rectOf(element)}
            view={view}
            padding={hitPadding}
            disabled={element.id === editingId}
            onPointerDown={(event) => handleElementPointerDown(event, element)}
            onDoubleClick={() => {
              if (element.type === "text") actions.startEditing(element.id);
            }}
          />
        ))}

        {selectionRect && !editingElement && (
          <SelectionLayer
            rect={selectionRect}
            element={selectedElements.length === 1 ? selectedElements[0] : null}
            view={view}
            cssPxPerPoint={cssPxPerPoint}
            onHandlePointerDown={handleHandlePointerDown}
          />
        )}

        {marquee && (
          <rect
            x={marquee.x * view.width}
            y={marquee.y * view.height}
            width={marquee.w * view.width}
            height={marquee.h * view.height}
            fill="#2563eb"
            fillOpacity={0.08}
            stroke="#2563eb"
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
          font={font}
          onPreview={(text) => actions.previewText(editingElement.id, text)}
          onFinish={(text) => actions.finishEdit(editingElement.id, text)}
        />
      )}
    </div>
  );
}

interface ElementHitAreaProps {
  element: EditorElement;
  rect: NormalizedRect;
  view: { width: number; height: number };
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
  rect,
  view,
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
    const d = element.points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x * view.width} ${point.y * view.height}`,
      )
      .join(" ");
    return (
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(element.strokeWidth, padding)}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...common}
      />
    );
  }

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
}
