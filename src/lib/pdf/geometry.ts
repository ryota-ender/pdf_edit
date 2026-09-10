import { clamp } from "./coordinates";
import { layoutTextBlock } from "./textLayout";
import type { FontBook } from "./font";
import type {
  EditorElement,
  NormalizedRect,
  PenElement,
  Point,
} from "@/types/editor";
import { isBoxElement } from "@/types/editor";

/** 要素の寸法を測るのに必要な文脈。 */
export interface MeasureContext {
  /** 回転適用後のページ寸法（PDFポイント）。 */
  view: { width: number; height: number };
  fonts: FontBook;
}

/**
 * 要素の外接矩形（正規化座標・要素自身の回転は考慮しない）
 * ------------------------------------------------------------------
 * これは「要素そのものの枠」。回転ハンドルや選択枠はこの矩形を回して描く。
 * 範囲選択の当たり判定など、軸に平行な矩形が要るところでは
 * `elementBoundingRect()` を使う。
 */
export function elementRect(
  element: EditorElement,
  ctx: MeasureContext,
): NormalizedRect {
  if (isBoxElement(element)) {
    return { x: element.x, y: element.y, w: element.w, h: element.h };
  }

  if (element.type === "text") {
    const font = ctx.fonts.get(element.fontWeight);
    const layout = layoutTextBlock(
      element.text,
      element.fontSize,
      font,
      element.width === null ? null : element.width * ctx.view.width,
    );
    return {
      x: element.x,
      y: element.y,
      w: layout.width / ctx.view.width,
      h: layout.height / ctx.view.height,
    };
  }

  if (element.type === "arrow") {
    return normalizeRect(element.x1, element.y1, element.x2, element.y2);
  }

  const xs = element.points.map((point) => point.x);
  const ys = element.points.map((point) => point.y);
  return normalizeRect(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  );
}

/** 矩形の中心。 */
export function rectCenter(rect: NormalizedRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * 点を中心のまわりに回す（時計回り・度）。
 * 画面座標は Y が下向きなので、この式が見た目の時計回りになる。
 *
 * 正規化座標は縦横で尺度が違うため、いったんページのポイント寸法へ
 * 直してから回し、戻す。そうしないと回転で形が歪む。
 */
export function rotatePoint(
  point: Point,
  center: Point,
  degrees: number,
  view: { width: number; height: number },
): Point {
  if (degrees === 0) return point;

  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const dx = (point.x - center.x) * view.width;
  const dy = (point.y - center.y) * view.height;

  return {
    x: center.x + (dx * cos - dy * sin) / view.width,
    y: center.y + (dx * sin + dy * cos) / view.height,
  };
}

/** 回転を適用した 4 隅。 */
export function rotatedCorners(
  rect: NormalizedRect,
  rotation: number,
  view: { width: number; height: number },
): Point[] {
  const center = rectCenter(rect);
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  return corners.map((corner) => rotatePoint(corner, center, rotation, view));
}

/** 回転を含めた軸平行の外接矩形。範囲選択や複数選択の枠に使う。 */
export function elementBoundingRect(
  element: EditorElement,
  ctx: MeasureContext,
): NormalizedRect {
  const rect = elementRect(element, ctx);
  if (element.rotation === 0) return rect;

  const corners = rotatedCorners(rect, element.rotation, ctx.view);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
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

/** 要素を平行移動する。 */
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
          ...point,
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
    default:
      return { ...element, x: element.x + dx, y: element.y + dy };
  }
}

/** リサイズハンドルの位置。`rotate` は回転専用のつまみ。 */
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
  | "end"
  | "rotate";

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

export function isCornerHandle(handle: HandleId): boolean {
  return (
    handle === "nw" || handle === "ne" || handle === "se" || handle === "sw"
  );
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
  rotate: "grab",
};

/** ハンドルの正規化座標（回転前の矩形上の位置）。 */
export function handlePosition(
  handle: HandleId,
  rect: NormalizedRect,
): Point {
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
    const byWidth = next.w / aspect >= next.h;
    const w = byWidth ? next.w : next.h * aspect;
    const h = byWidth ? next.w / aspect : next.h;
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
 * テキストは折り返し幅を持たない場合、矩形の変化量からフォントサイズを
 * 拡大縮小する（Figma などと同じ挙動）。折り返し幅を持つ場合は、
 * 横方向のリサイズが折り返し幅の変更になる。
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
    if (element.width !== null) {
      // 折り返し幅つき: 幅の変更は折り返し幅の変更になる。高さは行数で決まる。
      return { ...element, x: after.x, y: after.y, width: w };
    }
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
    points: penElement.points.map((point) => ({
      ...point,
      ...mapPoint(point.x, point.y),
    })),
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
  return {
    dx: clamp(dx, -rect.x - rect.w + margin, 1 - rect.x - margin),
    dy: clamp(dy, -rect.y - rect.h + margin, 1 - rect.y - margin),
  };
}

// ---------------------------------------------------------------------------
// 整列・等間隔配置
// ---------------------------------------------------------------------------

export type AlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom";

/**
 * 選択中の要素を揃えるための移動量を求める。
 * 全体を囲む矩形を基準にする。
 */
export function alignOffsets(
  rects: NormalizedRect[],
  mode: AlignMode,
): { dx: number; dy: number }[] {
  const bounds = unionRect(rects);
  if (!bounds) return rects.map(() => ({ dx: 0, dy: 0 }));

  return rects.map((rect) => {
    switch (mode) {
      case "left":
        return { dx: bounds.x - rect.x, dy: 0 };
      case "hcenter":
        return {
          dx: bounds.x + bounds.w / 2 - (rect.x + rect.w / 2),
          dy: 0,
        };
      case "right":
        return { dx: bounds.x + bounds.w - (rect.x + rect.w), dy: 0 };
      case "top":
        return { dx: 0, dy: bounds.y - rect.y };
      case "vcenter":
        return {
          dx: 0,
          dy: bounds.y + bounds.h / 2 - (rect.y + rect.h / 2),
        };
      default:
        return { dx: 0, dy: bounds.y + bounds.h - (rect.y + rect.h) };
    }
  });
}

/** 3 つ以上の要素を等間隔に並べるための移動量を求める。 */
export function distributeOffsets(
  rects: NormalizedRect[],
  axis: "horizontal" | "vertical",
): { dx: number; dy: number }[] {
  const offsets = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < 3) return offsets;

  const key = axis === "horizontal" ? "x" : "y";
  const sizeKey = axis === "horizontal" ? "w" : "h";

  const order = rects
    .map((rect, index) => ({ rect, index }))
    .sort((a, b) => a.rect[key] - b.rect[key]);

  const first = order[0].rect;
  const last = order[order.length - 1].rect;
  const span =
    last[key] + last[sizeKey] - first[key] -
    order.reduce((sum, item) => sum + item.rect[sizeKey], 0);
  const gap = span / (order.length - 1);

  let cursor = first[key] + first[sizeKey];
  for (let i = 1; i < order.length - 1; i += 1) {
    const { rect, index } = order[i];
    const target = cursor + gap;
    if (axis === "horizontal") offsets[index].dx = target - rect.x;
    else offsets[index].dy = target - rect.y;
    cursor = target + rect[sizeKey];
  }

  return offsets;
}

// ---------------------------------------------------------------------------
// スナップ
// ---------------------------------------------------------------------------

/** 画面上で何ピクセル以内なら吸着させるか。 */
export const SNAP_THRESHOLD_PX = 6;

export interface SnapGuide {
  axis: "x" | "y";
  /** 正規化座標での位置。 */
  position: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/**
 * ドラッグ中の矩形を、他の要素やページの基準線へ吸着させる。
 *
 * 吸着の候補は「相手の左端・中心・右端」と「ページの左端・中心・右端」。
 * 動かしている側も同じ 3 点で比べるので、端どうし・中心どうしが揃う。
 */
export function computeSnap(
  moving: NormalizedRect,
  targets: NormalizedRect[],
  view: { width: number; height: number },
  cssPxPerPoint: number,
): SnapResult {
  // しきい値は「画面上のピクセル」で決めたいので、正規化量へ直す。
  const thresholdX = SNAP_THRESHOLD_PX / (view.width * cssPxPerPoint);
  const thresholdY = SNAP_THRESHOLD_PX / (view.height * cssPxPerPoint);

  const movingX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const movingY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  const targetX = [0, 0.5, 1];
  const targetY = [0, 0.5, 1];
  for (const rect of targets) {
    targetX.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w);
    targetY.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h);
  }

  const guides: SnapGuide[] = [];
  let bestDx = 0;
  let bestDistanceX = thresholdX;
  for (const from of movingX) {
    for (const to of targetX) {
      const distance = Math.abs(to - from);
      if (distance < bestDistanceX) {
        bestDistanceX = distance;
        bestDx = to - from;
      }
    }
  }
  if (bestDx !== 0 || bestDistanceX < thresholdX) {
    const snapped = movingX
      .map((value) => value + bestDx)
      .find((value) => targetX.some((to) => Math.abs(to - value) < 1e-6));
    if (snapped !== undefined) guides.push({ axis: "x", position: snapped });
  }

  let bestDy = 0;
  let bestDistanceY = thresholdY;
  for (const from of movingY) {
    for (const to of targetY) {
      const distance = Math.abs(to - from);
      if (distance < bestDistanceY) {
        bestDistanceY = distance;
        bestDy = to - from;
      }
    }
  }
  if (bestDy !== 0 || bestDistanceY < thresholdY) {
    const snapped = movingY
      .map((value) => value + bestDy)
      .find((value) => targetY.some((to) => Math.abs(to - value) < 1e-6));
    if (snapped !== undefined) guides.push({ axis: "y", position: snapped });
  }

  return { dx: bestDx, dy: bestDy, guides };
}
