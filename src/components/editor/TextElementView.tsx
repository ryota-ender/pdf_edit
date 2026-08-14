"use client";

import { FONT_FAMILY } from "@/lib/pdf/font";
import { layoutTextBlock } from "@/lib/pdf/textLayout";
import type { LoadedFont } from "@/lib/pdf/font";
import type { TextElement } from "@/types/editor";

interface TextElementViewProps {
  element: TextElement;
  viewWidth: number;
  viewHeight: number;
  font: LoadedFont;
  isSelected: boolean;
  isEditing: boolean;
  onPointerDown: (event: React.PointerEvent<SVGRectElement>) => void;
  onDoubleClick: () => void;
}

/** ドラッグしやすいように、細い文字でも最低限の当たり判定を確保する。 */
const MIN_HIT_SIZE = 6;

/**
 * 編集レイヤーのテキスト 1 要素。
 *
 * SVG の <text> はベースラインを y に取るため、書き出し時の pdf-lib と
 * まったく同じ計算で位置を決められる。HTML の行ボックスを介さないので、
 * ブラウザごとの line-height 解釈のぶれが位置に影響しない。
 */
export function TextElementView({
  element,
  viewWidth,
  viewHeight,
  font,
  isSelected,
  isEditing,
  onPointerDown,
  onDoubleClick,
}: TextElementViewProps) {
  const layout = layoutTextBlock(element.text, element.fontSize, font);
  const x = element.x * viewWidth;
  const y = element.y * viewHeight;
  const hitWidth = Math.max(layout.width, MIN_HIT_SIZE);
  const hitHeight = Math.max(layout.height, MIN_HIT_SIZE);

  return (
    <g>
      {isSelected && (
        <rect
          x={x}
          y={y}
          width={hitWidth}
          height={hitHeight}
          fill="#3b82f6"
          fillOpacity={0.08}
          stroke="#2563eb"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {!isEditing && (
        <text
          fontFamily={FONT_FAMILY}
          fontSize={element.fontSize}
          fill={element.color}
          xmlSpace="preserve"
          style={{ whiteSpace: "pre" }}
          pointerEvents="none"
        >
          {layout.lines.map((line, index) => (
            <tspan key={index} x={x} y={y + layout.baselineOffsets[index]}>
              {line}
            </tspan>
          ))}
        </text>
      )}

      {/* 当たり判定。文字の隙間でも掴めるよう矩形全体を対象にする。 */}
      <rect
        x={x}
        y={y}
        width={hitWidth}
        height={hitHeight}
        fill="transparent"
        pointerEvents={isEditing ? "none" : "all"}
        className={isEditing ? undefined : "cursor-move"}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      />
    </g>
  );
}
