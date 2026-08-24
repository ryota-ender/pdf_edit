"use client";

import {
  BOX_HANDLES,
  HANDLE_CURSORS,
  handlePosition,
} from "@/lib/pdf/geometry";
import type { HandleId } from "@/lib/pdf/geometry";
import type { EditorElement, NormalizedRect } from "@/types/editor";

interface SelectionLayerProps {
  /** 選択中の要素すべてを囲む矩形。 */
  rect: NormalizedRect;
  /** 単一選択のときだけハンドルの種類を要素に合わせる。 */
  element: EditorElement | null;
  view: { width: number; height: number };
  /** 1 PDFポイントあたりの CSS ピクセル数。ハンドルの見た目を一定に保つ。 */
  cssPxPerPoint: number;
  onHandlePointerDown: (
    handle: HandleId,
    event: React.PointerEvent<SVGElement>,
  ) => void;
}

const HANDLE_SIZE_PX = 9;
const ACCENT = "#2563eb";

/**
 * 選択枠とリサイズハンドル。
 *
 * ハンドルは「画面上で常に同じ大きさ」に見えてほしいので、CSSピクセル数を
 * ポイント数へ割り戻してから描いている。ズームしても掴みやすさが変わらない。
 */
export function SelectionLayer({
  rect,
  element,
  view,
  cssPxPerPoint,
  onHandlePointerDown,
}: SelectionLayerProps) {
  const size = HANDLE_SIZE_PX / cssPxPerPoint;
  const half = size / 2;

  const box = {
    x: rect.x * view.width,
    y: rect.y * view.height,
    width: rect.w * view.width,
    height: rect.h * view.height,
  };

  // 矢印は両端を掴んで向きを変えたい。それ以外は 8 方向のハンドル。
  const isArrow = element?.type === "arrow";
  const handles: { id: HandleId; x: number; y: number }[] = isArrow
    ? [
        { id: "start", x: element.x1 * view.width, y: element.y1 * view.height },
        { id: "end", x: element.x2 * view.width, y: element.y2 * view.height },
      ]
    : BOX_HANDLES.map((id) => {
        const point = handlePosition(id, rect);
        return { id, x: point.x * view.width, y: point.y * view.height };
      });

  return (
    <g pointerEvents="none">
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        strokeDasharray={isArrow ? "4 3" : undefined}
      />

      {handles.map((handle) => (
        <rect
          key={handle.id}
          x={handle.x - half}
          y={handle.y - half}
          width={size}
          height={size}
          rx={isArrow ? half : half / 3}
          fill="#ffffff"
          stroke={ACCENT}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          pointerEvents="all"
          style={{ cursor: HANDLE_CURSORS[handle.id] }}
          onPointerDown={(event) => onHandlePointerDown(handle.id, event)}
        />
      ))}
    </g>
  );
}
