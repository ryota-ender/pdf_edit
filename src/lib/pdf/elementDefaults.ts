import { DEFAULT_FONT_SIZE, DEFAULT_TEXT } from "./textLayout";
import { isBoxElement } from "@/types/editor";
import type {
  ArrowElement,
  DrawToolId,
  EditorElement,
  EllipseElement,
  HighlightElement,
  ImageElement,
  NormalizedRect,
  PenElement,
  RectElement,
  TextElement,
} from "@/types/editor";

/** 新規要素の見た目の初期値。ツールバーの色選択と共有する。 */
export interface StyleDefaults {
  textColor: string;
  fontSize: number;
  shapeStroke: string;
  shapeFill: string | null;
  strokeWidth: number;
  highlightColor: string;
  penColor: string;
  penWidth: number;
}

export const INITIAL_STYLE: StyleDefaults = {
  textColor: "#111827",
  fontSize: DEFAULT_FONT_SIZE,
  shapeStroke: "#2563eb",
  shapeFill: null,
  strokeWidth: 2,
  highlightColor: "#fde047",
  penColor: "#dc2626",
  penWidth: 3,
};

export function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function createTextElement(
  pageIndex: number,
  x: number,
  y: number,
  style: StyleDefaults,
): TextElement {
  return {
    id: createId("text"),
    type: "text",
    pageIndex,
    x,
    y,
    opacity: 1,
    text: DEFAULT_TEXT,
    fontSize: style.fontSize,
    color: style.textColor,
    align: "left",
  };
}

export function createImageElement(
  pageIndex: number,
  rect: NormalizedRect,
  assetId: string,
): ImageElement {
  return {
    id: createId("image"),
    type: "image",
    pageIndex,
    opacity: 1,
    assetId,
    ...rect,
  };
}

/**
 * ドラッグで作る図形を生成する。
 * 描き始めの時点では大きさ 0 なので、ドラッグ中に `updateDrawElement` で
 * 形を更新していく。
 */
export function createDrawElement(
  tool: DrawToolId,
  pageIndex: number,
  x: number,
  y: number,
  style: StyleDefaults,
): EditorElement {
  switch (tool) {
    case "rect":
      return {
        id: createId("rect"),
        type: "rect",
        pageIndex,
        opacity: 1,
        x,
        y,
        w: 0,
        h: 0,
        fill: style.shapeFill,
        stroke: style.shapeStroke,
        strokeWidth: style.strokeWidth,
        radius: 0,
      } satisfies RectElement;

    case "ellipse":
      return {
        id: createId("ellipse"),
        type: "ellipse",
        pageIndex,
        opacity: 1,
        x,
        y,
        w: 0,
        h: 0,
        fill: style.shapeFill,
        stroke: style.shapeStroke,
        strokeWidth: style.strokeWidth,
      } satisfies EllipseElement;

    case "highlight":
      return {
        id: createId("highlight"),
        type: "highlight",
        pageIndex,
        opacity: 0.45,
        x,
        y,
        w: 0,
        h: 0,
        color: style.highlightColor,
      } satisfies HighlightElement;

    case "arrow":
      return {
        id: createId("arrow"),
        type: "arrow",
        pageIndex,
        opacity: 1,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        color: style.shapeStroke,
        strokeWidth: style.strokeWidth,
        head: true,
      } satisfies ArrowElement;

    default:
      return {
        id: createId("pen"),
        type: "pen",
        pageIndex,
        opacity: 1,
        points: [{ x, y }],
        color: style.penColor,
        strokeWidth: style.penWidth,
      } satisfies PenElement;
  }
}

/** ドラッグ中の図形を、現在のポインタ位置に合わせて更新する。 */
export function updateDrawElement(
  element: EditorElement,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  options: { constrain?: boolean } = {},
): EditorElement {
  if (element.type === "pen") {
    const last = element.points.at(-1);
    // 近すぎる点は捨てる。点数が増えすぎると描画も書き出しも重くなる。
    if (last && Math.hypot(currentX - last.x, currentY - last.y) < 0.002) {
      return element;
    }
    return { ...element, points: [...element.points, { x: currentX, y: currentY }] };
  }

  if (element.type === "arrow") {
    let endX = currentX;
    let endY = currentY;
    if (options.constrain) {
      // Shift で水平・垂直・45度に吸着させる。
      const dx = currentX - startX;
      const dy = currentY - startY;
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const length = Math.hypot(dx, dy);
      endX = startX + Math.cos(angle) * length;
      endY = startY + Math.sin(angle) * length;
    }
    return { ...element, x1: startX, y1: startY, x2: endX, y2: endY };
  }

  // ここへ来るのは矩形で大きさが決まる図形だけ。
  if (!isBoxElement(element)) return element;

  let width = Math.abs(currentX - startX);
  let height = Math.abs(currentY - startY);
  if (options.constrain) {
    const size = Math.max(width, height);
    width = size;
    height = size;
  }

  return {
    ...element,
    x: currentX < startX ? startX - width : startX,
    y: currentY < startY ? startY - height : startY,
    w: width,
    h: height,
  };
}

/** 描き終えた図形が小さすぎて事故で作られたものかどうか。 */
export function isDegenerate(element: EditorElement): boolean {
  if (element.type === "pen") return element.points.length < 2;
  if (element.type === "arrow") {
    return Math.hypot(element.x2 - element.x1, element.y2 - element.y1) < 0.01;
  }
  if (element.type === "text") return false;
  return element.w < 0.005 || element.h < 0.005;
}

export const ELEMENT_LABELS: Record<EditorElement["type"], string> = {
  text: "テキスト",
  rect: "四角形",
  ellipse: "円",
  highlight: "ハイライト",
  arrow: "矢印",
  pen: "フリーハンド",
  image: "画像",
};
