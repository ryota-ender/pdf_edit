import { clamp } from "./coordinates";
import { layoutTextBlock } from "./textLayout";
import type { LoadedFont } from "./font";
import type {
  EditorElement,
  NormalizedRect,
  PenElement,
} from "@/types/editor";
import { isBoxElement } from "@/types/editor";

/**
 * 要素の外接矩形（正規化座標）
 * ------------------------------------------------------------------
 * 選択枠・リサイズハンドル・複数選択の範囲計算は、すべてここで求めた
 * 矩形を基準にする。テキストだけは幅と高さが文字列とフォントサイズから
 * 決まるので、実フォントのメトリクスで実測する。
 */
export function elementRect(
  element: EditorElement,
  view: { width: number; height: number },
  font: LoadedFont,
): NormalizedRect {
  if (isBoxElement(element)) {
    return { x: element.x, y: element.y, w: element.w, h: element.h };
  }

  if (element.type === "text") {
    const layout = layoutTextBlock(element.text, element.fontSize, font);
    return {
      x: element.x,
      y: element.y,
      w: layout.width / view.width,
      h: layout.height / view.height,
    };
  }

  if (element.type === "arrow") {
    return normalizeRect(element.x1, element.y1, element.x2, element.y2);
  }

  // pen
  const xs = element.points.map((point) => point.x);
  const ys = element.points.map((point) => point.y);
  return normalizeRect(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  );
}

/** 2 点から、幅・高さが必ず正になる矩形を作る。 */
export function normalizeRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): NormalizedRect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/** 複数要素をまとめて囲む矩形。 */
export function unionRect(rects: NormalizedRect[]): NormalizedRect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function rectsIntersect(a: NormalizedRect, b: NormalizedRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/**
 * 要素を平行移動する。
 * ページ外へ完全に出てしまわないよう、呼び出し側で移動量を丸めてから渡す。
 */
export function translateElement(
  element: EditorElement,
  dx: number,
  dy: number,
): EditorElement {
  switch (element.type) {
    case "arrow":
      return {
        ...element,
        x1: element.x1 + dx,
        y1: element.y1 + dy,
        x2: element.x2 + dx,
        y2: element.y2 + dy,
      };
    case "pen":
      return {
        ...element,
        points: element.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
    default:
      return { ...element, x: element.x + dx, y: element.y + dy };
  }
}

/** リサイズハンドルの位置。 */
export type HandleId =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "start"
  | "end";

export const BOX_HANDLES: HandleId[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** 角のハンドルかどうか（縦横比を保つ判定に使う）。 */
export function isCornerHandle(handle: HandleId): boolean {
  return handle === "nw" || handle === "ne" || handle === "se" || handle === "sw";
}

export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  start: "move",
  end: "move",
};

/** ハンドルの正規化座標（矩形上の位置）。 */
export function handlePosition(
  handle: HandleId,
  rect: NormalizedRect,
): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;

  switch (handle) {
    case "nw":
      return { x: rect.x, y: rect.y };
    case "n":
      return { x: cx, y: rect.y };
    case "ne":
      return { x: right, y: rect.y };
    case "e":
      return { x: right, y: cy };
    case "se":
      return { x: right, y: bottom };
    case "s":
      return { x: cx, y: bottom };
    case "sw":
      return { x: rect.x, y: bottom };
    default:
      return { x: rect.x, y: cy };
  }
}

/**
 * ハンドルを動かした結果の矩形を求める。
 * 反転（左端を右端より右へ動かす等）しても破綻しないよう正規化する。
 */
export function resizeRect(
  rect: NormalizedRect,
  handle: HandleId,
  pointerX: number,
  pointerY: number,
  options: { keepAspect?: boolean } = {},
): NormalizedRect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;

  if (handle.includes("w")) left = pointerX;
  if (handle.includes("e")) right = pointerX;
  if (handle.includes("n")) top = pointerY;
  if (handle.includes("s")) bottom = pointerY;

  const next = normalizeRect(left, top, right, bottom);

  if (options.keepAspect && rect.w > 0 && rect.h > 0) {
    const aspect = rect.w / rect.h;
    // 動かした量が大きい方の辺に合わせる。
    const byWidth = next.w / aspect >= next.h;
    const w = byWidth ? next.w : next.h * aspect;
    const h = byWidth ? next.w / aspect : next.h;
    // 掴んでいない側の角を固定する。
    const anchorX = handle.includes("w") ? rect.x + rect.w : rect.x;
    const anchorY = handle.includes("n") ? rect.y + rect.h : rect.y;
    return {
      x: handle.includes("w") ? anchorX - w : anchorX,
      y: handle.includes("n") ? anchorY - h : anchorY,
      w,
      h,
    };
  }

  return next;
}

/** ごく小さな矩形はクリックできなくなるので、最小サイズを設ける。 */
const MIN_NORMALIZED_SIZE = 0.004;

/**
 * リサイズ結果を要素へ反映する。
 *
 * テキストは幅・高さを直接持たないため、矩形の変化量からフォントサイズを
 * 拡大縮小する（Figma などと同じ挙動）。こうすると文字の折り返しが発生せず、
 * 書き出し位置の計算もそのまま使える。
 */
export function applyResize(
  element: EditorElement,
  before: NormalizedRect,
  after: NormalizedRect,
  fontSizeRange: { min: number; max: number },
): EditorElement {
  const w = Math.max(after.w, MIN_NORMALIZED_SIZE);
  const h = Math.max(after.h, MIN_NORMALIZED_SIZE);

  if (isBoxElement(element)) {
    return { ...element, x: after.x, y: after.y, w, h };
  }

  if (element.type === "text") {
    const scale =
      before.w > 0 && before.h > 0
        ? Math.min(after.w / before.w, after.h / before.h)
        : 1;
    return {
      ...element,
      x: after.x,
      y: after.y,
      fontSize: clamp(
        element.fontSize * scale,
        fontSizeRange.min,
        fontSizeRange.max,
      ),
    };
  }

  // arrow / pen は矩形の変化に合わせて各点を写像する。
  const scaleX = before.w > 0 ? w / before.w : 1;
  const scaleY = before.h > 0 ? h / before.h : 1;
  const mapPoint = (px: number, py: number) => ({
    x: after.x + (px - before.x) * scaleX,
    y: after.y + (py - before.y) * scaleY,
  });

  if (element.type === "arrow") {
    const start = mapPoint(element.x1, element.y1);
    const end = mapPoint(element.x2, element.y2);
    return { ...element, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  const penElement = element as PenElement;
  return {
    ...penElement,
    points: penElement.points.map((point) => mapPoint(point.x, point.y)),
  };
}

/**
 * ドラッグ移動量を、要素がページから完全に出ないように制限する。
 * 端が少しはみ出すのは許すが、必ず一部が見えている状態を保つ。
 */
export function clampTranslation(
  rect: NormalizedRect,
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  const margin = 0.02;
  const minX = -rect.x - rect.w + margin;
  const maxX = 1 - rect.x - margin;
  const minY = -rect.y - rect.h + margin;
  const maxY = 1 - rect.y - margin;
  return {
    dx: clamp(dx, minX, maxX),
    dy: clamp(dy, minY, maxY),
  };
}
