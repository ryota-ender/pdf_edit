"use client";

import { FONT_FAMILY } from "@/lib/pdf/font";
import { layoutTextBlock } from "@/lib/pdf/textLayout";
import type { LoadedFont } from "@/lib/pdf/font";
import type { ImageAssetStore } from "@/lib/pdf/imageAssets";
import type { EditorElement } from "@/types/editor";

interface ElementViewProps {
  element: EditorElement;
  /** 回転適用後のページ寸法（PDFポイント）。SVG の viewBox と同じ単位。 */
  view: { width: number; height: number };
  font: LoadedFont;
  images: ImageAssetStore;
  /** 編集中のテキストは SVG 側では描かない（textarea と二重になるため）。 */
  isEditing: boolean;
}

/**
 * 編集レイヤーの要素 1 つを SVG で描く。
 *
 * SVG を使う理由は位置の再現性。<text> は y がそのままベースラインになり、
 * PDF の描画モデルと一致するため、書き出し時と同じ計算をそのまま使える。
 * 図形も同様に、PDFポイント単位の viewBox 上に描くので、ズームしても
 * 内部の座標値は変わらない。
 */
export function ElementView({
  element,
  view,
  font,
  images,
  isEditing,
}: ElementViewProps) {
  switch (element.type) {
    case "text": {
      if (isEditing) return null;
      const layout = layoutTextBlock(element.text, element.fontSize, font);
      const left = element.x * view.width;
      const top = element.y * view.height;

      return (
        <text
          fontFamily={FONT_FAMILY}
          fontSize={element.fontSize}
          fill={element.color}
          opacity={element.opacity}
          xmlSpace="preserve"
          style={{ whiteSpace: "pre" }}
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
      const start = {
        x: element.x1 * view.width,
        y: element.y1 * view.height,
      };
      const end = { x: element.x2 * view.width, y: element.y2 * view.height };
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.max(6, element.strokeWidth * 3.5);
      const halfWidth = Math.max(3, element.strokeWidth * 2);

      return (
        <g opacity={element.opacity} pointerEvents="none">
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={element.color}
            strokeWidth={element.strokeWidth}
            strokeLinecap="round"
          />
          {element.head && (
            <polygon
              points={[
                `${end.x},${end.y}`,
                `${end.x - length * Math.cos(angle) + halfWidth * Math.sin(angle)},${
                  end.y - length * Math.sin(angle) - halfWidth * Math.cos(angle)
                }`,
                `${end.x - length * Math.cos(angle) - halfWidth * Math.sin(angle)},${
                  end.y - length * Math.sin(angle) + halfWidth * Math.cos(angle)
                }`,
              ].join(" ")}
              fill={element.color}
            />
          )}
        </g>
      );
    }

    case "pen": {
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
