"use client";

import { BOX_HANDLES, HANDLE_CURSORS, handlePosition } from "@/lib/pdf/geometry";
import type { HandleId } from "@/lib/pdf/geometry";
import type { EditorElement, NormalizedRect, Point } from "@/types/editor";

interface SelectionLayerProps {
  /** 選択枠の矩形（回転前）。複数選択のときは全体を囲む矩形。 */
  rect: NormalizedRect;
  /** 単一選択のときだけ、要素に合わせたハンドルを出す。 */
  element: EditorElement | null;
  /** 枠ごと回す角度（度）。 */
  rotation: number;
  /** 回転の軸（PDFポイント）。 */
  center: Point;
  view: { width: number; height: number };
  /** 1 PDFポイントあたりの CSS ピクセル数。ハンドルの見た目を一定に保つ。 */
  cssPxPerPoint: number;
  onHandlePointerDown: (
    handle: HandleId,
    event: React.PointerEvent<SVGElement>,
  ) => void;
}

const HANDLE_SIZE_PX = 9;
const ROTATE_OFFSET_PX = 22;
const ACCENT = "#2563eb";

/**
 * 選択枠とハンドル。
 *
 * ハンドルは「画面上で常に同じ大きさ」に見えてほしいので、CSSピクセル数を
 * ポイント数へ割り戻してから描く。ズームしても掴みやすさが変わらない。
 * 要素が回転しているときは枠ごと回すので、ハンドルの向きも要素に付いてくる。
 */
export function SelectionLayer({
  rect,
  element,
  rotation,
  center,
  view,
  cssPxPerPoint,
  onHandlePointerDown,
}: SelectionLayerProps) {
  const size = HANDLE_SIZE_PX / cssPxPerPoint;
  const half = size / 2;
  const rotateOffset = ROTATE_OFFSET_PX / cssPxPerPoint;

  const box = {
    x: rect.x * view.width,
    y: rect.y * view.height,
    width: rect.w * view.width,
    height: rect.h * view.height,
  };

  const isArrow = element?.type === "arrow";
  const isCallout = element?.type === "callout";
  const isLocked = element?.locked ?? false;

  const handles: { id: HandleId; x: number; y: number; round?: boolean }[] =
    isArrow
      ? [
          {
            id: "start",
            x: element.x1 * view.width,
            y: element.y1 * view.height,
            round: true,
          },
          {
            id: "end",
            x: element.x2 * view.width,
            y: element.y2 * view.height,
            round: true,
          },
        ]
      : [
          ...BOX_HANDLES.map((id) => {
            const point = handlePosition(id, rect);
            return { id, x: point.x * view.width, y: point.y * view.height };
          }),
          // 吹き出しは指し先も掴んで動かせる。
          ...(isCallout
            ? [
                {
                  id: "target" as HandleId,
                  x: element.targetX * view.width,
                  y: element.targetY * view.height,
                  round: true,
                },
              ]
            : []),
        ];

  const content = (
    <>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke={isLocked ? "#94a3b8" : ACCENT}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        strokeDasharray={isArrow || isLocked ? "4 3" : undefined}
      />

      {/* ロック中はつまみを出さない（動かせないことを見た目でも示す）。 */}
      {!isLocked && (
        <>
          {handles.map((handle) => (
            <rect
              key={handle.id}
              x={handle.x - half}
              y={handle.y - half}
              width={size}
              height={size}
              rx={handle.round ? half : half / 3}
              fill="#ffffff"
              stroke={ACCENT}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="all"
              style={{ cursor: HANDLE_CURSORS[handle.id] }}
              onPointerDown={(event) => onHandlePointerDown(handle.id, event)}
            />
          ))}

          {/* 回転つまみ。上辺の少し外側に置く。 */}
          {!isArrow && element && (
            <>
              <line
                x1={box.x + box.width / 2}
                y1={box.y}
                x2={box.x + box.width / 2}
                y2={box.y - rotateOffset}
                stroke={ACCENT}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={box.x + box.width / 2}
                cy={box.y - rotateOffset}
                r={half}
                fill="#ffffff"
                stroke={ACCENT}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="all"
                style={{ cursor: "grab" }}
                onPointerDown={(event) => onHandlePointerDown("rotate", event)}
              />
            </>
          )}
        </>
      )}
    </>
  );

  return (
    <g pointerEvents="none">
      {rotation === 0 ? (
        content
      ) : (
        <g transform={`rotate(${rotation} ${center.x} ${center.y})`}>
          {content}
        </g>
      )}
    </g>
  );
}
