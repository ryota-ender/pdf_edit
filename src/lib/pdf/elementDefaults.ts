import { DEFAULT_FONT_SIZE, DEFAULT_TEXT } from "./textLayout";
import { isBoxElement } from "@/types/editor";
import type {
  ArrowElement,
  CalloutElement,
  DrawToolId,
  EditorElement,
  EllipseElement,
  FontWeight,
  HighlightElement,
  ImageElement,
  NormalizedRect,
  PenElement,
  PenPoint,
  RectElement,
  TextElement,
} from "@/types/editor";

/**
 * 新規要素の見た目の初期値。
 * ここは「最後に使った設定」を覚える器でもある。要素を作るたびに
 * 色や太さを選び直さなくて済むよう、インスペクタでの変更を書き戻す。
 */
export interface StyleDefaults {
  textColor: string;
  fontSize: number;
  fontWeight: FontWeight;
  italic: boolean;
  vertical: boolean;
  hanging: boolean;
  shapeStroke: string;
  shapeFill: string | null;
  strokeWidth: number;
  radius: number;
  highlightColor: string;
  highlightOpacity: number;
  penColor: string;
  penWidth: number;
  arrowHead: boolean;
}

export const INITIAL_STYLE: StyleDefaults = {
  textColor: "#111827",
  fontSize: DEFAULT_FONT_SIZE,
  fontWeight: "regular",
  italic: false,
  vertical: false,
  hanging: false,
  shapeStroke: "#2563eb",
  shapeFill: null,
  strokeWidth: 2,
  radius: 0,
  highlightColor: "#fde047",
  highlightOpacity: 0.45,
  penColor: "#dc2626",
  penWidth: 3,
  arrowHead: true,
};

/**
 * 要素の変更内容から「次に作る要素の既定値」を更新する。
 * 例えば赤で線を引いたら、次の線も赤で始まる。
 */
export function deriveStyle(
  style: StyleDefaults,
  element: EditorElement,
): StyleDefaults {
  switch (element.type) {
    case "text":
      return {
        ...style,
        textColor: element.color,
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        italic: element.italic,
        vertical: element.vertical,
        hanging: element.hanging,
      };
    case "rect":
      return {
        ...style,
        shapeStroke: element.stroke ?? style.shapeStroke,
        shapeFill: element.fill,
        strokeWidth: element.strokeWidth,
        radius: element.radius,
      };
    case "ellipse":
      return {
        ...style,
        shapeStroke: element.stroke ?? style.shapeStroke,
        shapeFill: element.fill,
        strokeWidth: element.strokeWidth,
      };
    case "highlight":
      return {
        ...style,
        highlightColor: element.color,
        highlightOpacity: element.opacity,
      };
    case "arrow":
      return {
        ...style,
        shapeStroke: element.color,
        strokeWidth: element.strokeWidth,
        arrowHead: element.head,
      };
    case "pen":
      return {
        ...style,
        penColor: element.color,
        penWidth: element.strokeWidth,
      };
    default:
      return style;
  }
}

export function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

/** すべての要素に共通する初期値。 */
function base(pageIndex: number) {
  return {
    pageIndex,
    opacity: 1,
    rotation: 0,
    locked: false,
    groupId: null,
    visible: true,
  };
}

export function createTextElement(
  pageIndex: number,
  x: number,
  y: number,
  style: StyleDefaults,
  overrides: Partial<TextElement> = {},
): TextElement {
  return {
    id: createId("text"),
    type: "text",
    ...base(pageIndex),
    x,
    y,
    text: DEFAULT_TEXT,
    fontSize: style.fontSize,
    color: style.textColor,
    align: "left",
    fontWeight: style.fontWeight,
    italic: style.italic,
    vertical: style.vertical,
    hanging: style.hanging,
    width: null,
    ...overrides,
  };
}

/** 吹き出し。枠と指し先をまとめて持つ。 */
export function createCalloutElement(
  pageIndex: number,
  rect: NormalizedRect,
  target: { x: number; y: number },
  style: StyleDefaults,
): CalloutElement {
  return {
    id: createId("callout"),
    type: "callout",
    ...base(pageIndex),
    ...rect,
    targetX: target.x,
    targetY: target.y,
    text: DEFAULT_TEXT,
    fontSize: style.fontSize,
    color: style.textColor,
    fontWeight: style.fontWeight,
    fill: "#ffffff",
    stroke: style.shapeStroke,
    strokeWidth: style.strokeWidth,
    radius: 4,
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
    ...base(pageIndex),
    assetId,
    ...rect,
  };
}

/** 既存テキストを覆い隠すための白い矩形。 */
export function createWhiteoutElement(
  pageIndex: number,
  rect: NormalizedRect,
  color: string,
): RectElement {
  return {
    id: createId("rect"),
    type: "rect",
    ...base(pageIndex),
    ...rect,
    fill: color,
    stroke: null,
    strokeWidth: 0,
    radius: 0,
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
  firstPoint?: PenPoint,
): EditorElement {
  switch (tool) {
    case "rect":
      return {
        id: createId("rect"),
        type: "rect",
        ...base(pageIndex),
        x,
        y,
        w: 0,
        h: 0,
        fill: style.shapeFill,
        stroke: style.shapeStroke,
        strokeWidth: style.strokeWidth,
        radius: style.radius,
      } satisfies RectElement;

    case "ellipse":
      return {
        id: createId("ellipse"),
        type: "ellipse",
        ...base(pageIndex),
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
        ...base(pageIndex),
        opacity: style.highlightOpacity,
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
        ...base(pageIndex),
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        color: style.shapeStroke,
        strokeWidth: style.strokeWidth,
        head: style.arrowHead,
      } satisfies ArrowElement;

    case "callout":
      return {
        id: createId("callout"),
        type: "callout",
        ...base(pageIndex),
        x,
        y,
        w: 0,
        h: 0,
        // 指し先は作った直後に左下へ少し離して置く。あとで掴んで動かせる。
        targetX: Math.max(0, x - 0.08),
        targetY: Math.min(1, y + 0.12),
        text: DEFAULT_TEXT,
        fontSize: Math.min(style.fontSize, 14),
        color: style.textColor,
        fontWeight: style.fontWeight,
        fill: "#ffffff",
        stroke: style.shapeStroke,
        strokeWidth: style.strokeWidth,
        radius: 4,
      } satisfies CalloutElement;

    default:
      return {
        id: createId("pen"),
        type: "pen",
        ...base(pageIndex),
        points: [firstPoint ?? { x, y }],
        color: style.penColor,
        strokeWidth: style.penWidth,
        pressure: false,
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
  options: { constrain?: boolean; pressure?: number } = {},
): EditorElement {
  if (element.type === "pen") {
    const last = element.points.at(-1);
    // 近すぎる点は捨てる。点数が増えすぎると描画も書き出しも重くなる。
    if (last && Math.hypot(currentX - last.x, currentY - last.y) < 0.002) {
      return element;
    }
    const point: PenPoint = { x: currentX, y: currentY };
    if (options.pressure !== undefined) point.p = options.pressure;
    return {
      ...element,
      points: [...element.points, point],
      pressure: element.pressure || options.pressure !== undefined,
    };
  }

  if (element.type === "arrow") {
    let endX = currentX;
    let endY = currentY;
    if (options.constrain) {
      // Shift で水平・垂直・45度に吸着させる。
      const dx = currentX - startX;
      const dy = currentY - startY;
      const angle =
        Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
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
  callout: "吹き出し",
  text: "テキスト",
  rect: "四角形",
  ellipse: "円",
  highlight: "ハイライト",
  arrow: "矢印",
  pen: "フリーハンド",
  image: "画像",
};
