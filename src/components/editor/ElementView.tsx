"use client";

import { memo } from "react";
import { FONT_FAMILIES, ITALIC_SKEW_DEGREES } from "@/lib/pdf/font";
import { CALLOUT_PADDING, textLayoutFor } from "@/lib/pdf/textLayout";
import {
  arrowHeadPoints,
  calloutAnchor,
  penOutline,
} from "@/lib/pdf/drawElements";
import type { FontBook } from "@/lib/pdf/font";
import type { ImageAssetStore } from "@/lib/pdf/imageAssets";
import type { EditorElement, Point } from "@/types/editor";

interface ElementViewProps {
  element: EditorElement;
  /** 回転適用後のページ寸法（PDFポイント）。SVG の viewBox と同じ単位。 */
  view: { width: number; height: number };
  fonts: FontBook;
  images: ImageAssetStore;
  /** 編集中のテキストは SVG 側では描かない（textarea と二重になるため）。 */
  isEditing: boolean;
}

/**
 * 編集レイヤーの要素 1 つを SVG で描く。
 *
 * SVG を使う理由は位置の再現性。<text> は y がそのままベースラインになり、
 * PDF の描画モデルと一致するため、書き出し時と同じ計算をそのまま使える。
 * 図形も PDFポイント単位の viewBox 上に描くので、ズームしても内部の
 * 座標値は変わらない。
 *
 * 要素自身の回転は <g transform="rotate()"> で表す。viewBox がポイント
 * 単位なので、書き出し側の回転計算と同じ結果になる。
 */
export const ElementView = memo(function ElementView({
  element,
  view,
  fonts,
  images,
  isEditing,
}: ElementViewProps) {
  if (!element.visible) return null;

  const body = renderBody(element, view, fonts, images, isEditing);
  if (!body) return null;
  if (element.rotation === 0) return body;

  const center = elementCenter(element, view, fonts);
  return (
    <g
      transform={`rotate(${element.rotation} ${center.x} ${center.y})`}
      pointerEvents="none"
    >
      {body}
    </g>
  );
});

/** 回転の軸になる中心点（PDFポイント）。 */
export function elementCenter(
  element: EditorElement,
  view: { width: number; height: number },
  fonts: FontBook,
): Point {
  if (element.type === "text") {
    const layout = textLayoutOf(element, view, fonts);
    return {
      x: element.x * view.width + layout.width / 2,
      y: element.y * view.height + layout.height / 2,
    };
  }
  if (element.type === "arrow") {
    return {
      x: ((element.x1 + element.x2) / 2) * view.width,
      y: ((element.y1 + element.y2) / 2) * view.height,
    };
  }
  if (element.type === "pen") {
    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    return {
      x: ((Math.min(...xs) + Math.max(...xs)) / 2) * view.width,
      y: ((Math.min(...ys) + Math.max(...ys)) / 2) * view.height,
    };
  }
  return {
    x: (element.x + element.w / 2) * view.width,
    y: (element.y + element.h / 2) * view.height,
  };
}

function textLayoutOf(
  element: Extract<EditorElement, { type: "text" | "callout" }>,
  view: { width: number; height: number },
  fonts: FontBook,
) {
  return textLayoutFor(element, fonts.get(element.fontWeight), view);
}

/**
 * 文字を 1 つずつ置く。位置は書き出し側とまったく同じ計算
 * (`textLayoutFor`) から来るので、プレビューと出力が一致する。
 */
function GlyphRun({
  layout,
  originX,
  originY,
  element,
}: {
  layout: ReturnType<typeof textLayoutOf>;
  originX: number;
  originY: number;
  element: Extract<EditorElement, { type: "text" | "callout" }>;
}) {
  const italic = element.type === "text" && element.italic;

  return (
    <text
      fontFamily={FONT_FAMILIES[element.fontWeight]}
      fontSize={element.fontSize}
      fill={element.color}
      opacity={element.opacity}
      xmlSpace="preserve"
      style={{ whiteSpace: "pre" }}
      pointerEvents="none"
    >
      {layout.lines.flatMap((line, lineIndex) =>
        line.glyphs.map((glyph, glyphIndex) => {
          const x = originX + glyph.x;
          const y = originY + glyph.y;
          // 縦書きで倒す文字と疑似イタリックは、その文字だけ変形させる。
          const transforms = [
            glyph.rotated ? `rotate(90 ${x} ${y})` : "",
            italic ? `skewX(${-ITALIC_SKEW_DEGREES})` : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <tspan
              key={`${lineIndex}-${glyphIndex}`}
              x={x}
              y={y}
              transform={transforms || undefined}
            >
              {glyph.char}
            </tspan>
          );
        }),
      )}
    </text>
  );
}

function renderBody(
  element: EditorElement,
  view: { width: number; height: number },
  fonts: FontBook,
  images: ImageAssetStore,
  isEditing: boolean,
) {
  switch (element.type) {
    case "text": {
      if (isEditing) return null;
      const layout = textLayoutOf(element, view, fonts);
      return (
        <GlyphRun
          layout={layout}
          originX={element.x * view.width}
          originY={element.y * view.height}
          element={element}
        />
      );
    }

    case "callout": {
      const layout = textLayoutOf(element, view, fonts);
      const rect = {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
      };
      const anchor = calloutAnchor(rect, {
        x: element.targetX,
        y: element.targetY,
      });

      return (
        <g opacity={element.opacity} pointerEvents="none">
          <line
            x1={anchor.x * view.width}
            y1={anchor.y * view.height}
            x2={element.targetX * view.width}
            y2={element.targetY * view.height}
            stroke={element.stroke ?? element.color}
            strokeWidth={Math.max(0.5, element.strokeWidth)}
            strokeLinecap="round"
          />
          <rect
            x={element.x * view.width}
            y={element.y * view.height}
            width={element.w * view.width}
            height={element.h * view.height}
            rx={element.radius}
            fill={element.fill ?? "none"}
            stroke={element.stroke ?? "none"}
            strokeWidth={element.strokeWidth}
          />
          {!isEditing && (
            <GlyphRun
              layout={layout}
              originX={element.x * view.width + CALLOUT_PADDING}
              originY={element.y * view.height + CALLOUT_PADDING}
              element={element}
            />
          )}
        </g>
      );
    }

    case "highlight":
      return (
        <rect
          x={element.x * view.width}
          y={element.y * view.height}
          width={element.w * view.width}
          height={element.h * view.height}
          fill={element.color}
          opacity={element.opacity}
          // 書き出し時の乗算合成と見え方を合わせる。
          style={{ mixBlendMode: "multiply" }}
          pointerEvents="none"
        />
      );

    case "rect":
      return (
        <rect
          x={element.x * view.width}
          y={element.y * view.height}
          width={element.w * view.width}
          height={element.h * view.height}
          rx={element.radius}
          fill={element.fill ?? "none"}
          stroke={element.stroke ?? "none"}
          strokeWidth={element.strokeWidth}
          opacity={element.opacity}
          pointerEvents="none"
        />
      );

    case "ellipse":
      return (
        <ellipse
          cx={(element.x + element.w / 2) * view.width}
          cy={(element.y + element.h / 2) * view.height}
          rx={(element.w / 2) * view.width}
          ry={(element.h / 2) * view.height}
          fill={element.fill ?? "none"}
          stroke={element.stroke ?? "none"}
          strokeWidth={element.strokeWidth}
          opacity={element.opacity}
          pointerEvents="none"
        />
      );

    case "arrow": {
      const start = { x: element.x1, y: element.y1 };
      const end = { x: element.x2, y: element.y2 };
      const head = arrowHeadPoints(start, end, element.strokeWidth, view);

      return (
        <g opacity={element.opacity} pointerEvents="none">
          <line
            x1={start.x * view.width}
            y1={start.y * view.height}
            x2={end.x * view.width}
            y2={end.y * view.height}
            stroke={element.color}
            strokeWidth={element.strokeWidth}
            strokeLinecap="round"
          />
          {element.head && (
            <polygon
              points={head
                .map((point) => `${point.x * view.width},${point.y * view.height}`)
                .join(" ")}
              fill={element.color}
            />
          )}
        </g>
      );
    }

    case "pen": {
      if (element.points.length < 2) return null;

      // 筆圧つきは輪郭を塗る。書き出し側と同じ関数で形を作る。
      if (element.pressure) {
        const outline = penOutline(element.points, element.strokeWidth, view);
        return (
          <polygon
            points={outline
              .map((point) => `${point.x * view.width},${point.y * view.height}`)
              .join(" ")}
            fill={element.color}
            opacity={element.opacity}
            pointerEvents="none"
          />
        );
      }

      return (
        <path
          d={penPathData(element.points, view)}
          fill="none"
          stroke={element.color}
          strokeWidth={element.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={element.opacity}
          pointerEvents="none"
        />
      );
    }

    case "image": {
      const asset = images.get(element.assetId);
      if (!asset) return null;
      return (
        <image
          href={asset.objectUrl}
          x={element.x * view.width}
          y={element.y * view.height}
          width={element.w * view.width}
          height={element.h * view.height}
          opacity={element.opacity}
          preserveAspectRatio="none"
          pointerEvents="none"
        />
      );
    }
  }
}

export function penPathData(
  points: { x: number; y: number }[],
  view: { width: number; height: number },
): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x * view.width} ${point.y * view.height}`,
    )
    .join(" ");
}
