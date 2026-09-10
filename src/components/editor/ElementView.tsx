"use client";

import { FONT_FAMILIES, ITALIC_SKEW_DEGREES } from "@/lib/pdf/font";
import { layoutTextBlock } from "@/lib/pdf/textLayout";
import { arrowHeadPoints, penOutline } from "@/lib/pdf/drawElements";
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
export function ElementView({
  element,
  view,
  fonts,
  images,
  isEditing,
}: ElementViewProps) {
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
}

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
  element: Extract<EditorElement, { type: "text" }>,
  view: { width: number; height: number },
  fonts: FontBook,
) {
  return layoutTextBlock(
    element.text,
    element.fontSize,
    fonts.get(element.fontWeight),
    element.width === null ? null : element.width * view.width,
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
      const font = fonts.get(element.fontWeight);
      const layout = textLayoutOf(element, view, fonts);
      const left = element.x * view.width;
      const top = element.y * view.height;

      return (
        <text
          fontFamily={FONT_FAMILIES[element.fontWeight]}
          fontSize={element.fontSize}
          fill={element.color}
          opacity={element.opacity}
          xmlSpace="preserve"
          style={{
            whiteSpace: "pre",
            // 書き出し側の xSkew と見え方を合わせた疑似イタリック。
            ...(element.italic
              ? { transform: `skewX(${-ITALIC_SKEW_DEGREES}deg)`, transformBox: "fill-box" }
              : {}),
          }}
          pointerEvents="none"
        >
          {layout.lines.map((line, index) => {
            const lineWidth = font.measureText(line, element.fontSize);
            const offset =
              element.align === "center"
                ? (layout.width - lineWidth) / 2
                : element.align === "right"
                  ? layout.width - lineWidth
                  : 0;
            return (
              <tspan
                key={index}
                x={left + offset}
                y={top + layout.baselineOffsets[index]}
              >
                {line}
              </tspan>
            );
          })}
        </text>
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
