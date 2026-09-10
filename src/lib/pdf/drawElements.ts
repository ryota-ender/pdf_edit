import {
  LineCapStyle,
  LineJoinStyle,
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  degrees,
  drawObject,
  drawLinesOfText,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
} from "pdf-lib";
import type { PDFFont, PDFName, PDFOperator } from "pdf-lib";
import { hexToRgb01, viewPointToPdfPoint } from "./coordinates";
import { LINE_HEIGHT_FACTOR, layoutTextBlock } from "./textLayout";
import { ITALIC_SKEW_DEGREES } from "./font";
import { rectCenter, rotatePoint } from "./geometry";
import type { FontBook } from "./font";
import type {
  EditorElement,
  FontWeight,
  NormalizedRect,
  PenPoint,
  Point,
} from "@/types/editor";
import { isBoxElement } from "@/types/editor";

/** 円弧をベジェ 4 本で近似するときの制御点の比率。 */
const KAPPA = 0.5522847498;

export interface PageGeometry {
  cropBox: { x: number; y: number; width: number; height: number };
  /** 書き出し後のページに設定される最終的な回転角。 */
  rotation: number;
  /** 回転を適用した後のページ寸法（PDFポイント）。 */
  view: { width: number; height: number };
}

/** 正規化座標 (左上原点) → PDF ユーザー空間 (左下原点)。 */
export function normalizedToPdf(
  geo: PageGeometry,
  nx: number,
  ny: number,
): Point {
  return viewPointToPdfPoint(
    nx * geo.view.width,
    ny * geo.view.height,
    geo.cropBox,
    geo.rotation,
  );
}

/**
 * 描画に必要な資源をまとめたもの。
 * ページ本体へ描くときと、注釈の外観ストリームへ描くときで、
 * 同じ組み立て処理を使えるようにしている。
 */
export interface DrawResources {
  geo: PageGeometry;
  fonts: FontBook;
  /** 不透明度・合成モードを設定した ExtGState の名前を作る。 */
  graphicsState: (options: {
    opacity?: number;
    borderOpacity?: number;
    blendMode?: string;
  }) => PDFName | undefined;
  /** 埋め込み済みフォントとそのリソース名。 */
  font: (weight: FontWeight) => { font: PDFFont; name: PDFName };
  /** 埋め込み済み画像のリソース名と実寸。 */
  image: (
    assetId: string,
  ) => { name: PDFName; width: number; height: number } | undefined;
}

// ---------------------------------------------------------------------------
// パスの組み立て
// ---------------------------------------------------------------------------

type PathSegment =
  | { kind: "M"; p: Point }
  | { kind: "L"; p: Point }
  | { kind: "C"; c1: Point; c2: Point; p: Point }
  | { kind: "Z" };

/**
 * 正規化座標で組んだパスを、要素の回転を適用してから PDF 座標の
 * オペレータ列へ変換する。
 *
 * ベジェの制御点も同じ変換に通せばよいので、回転しても形が崩れない。
 */
function pathToOperators(
  segments: PathSegment[],
  geo: PageGeometry,
  rotation: number,
  center: Point,
): PDFOperator[] {
  const map = (point: Point): Point => {
    const rotated =
      rotation === 0 ? point : rotatePoint(point, center, rotation, geo.view);
    return normalizedToPdf(geo, rotated.x, rotated.y);
  };

  const operators: PDFOperator[] = [];
  for (const segment of segments) {
    switch (segment.kind) {
      case "M": {
        const p = map(segment.p);
        operators.push(moveTo(p.x, p.y));
        break;
      }
      case "L": {
        const p = map(segment.p);
        operators.push(lineTo(p.x, p.y));
        break;
      }
      case "C": {
        const c1 = map(segment.c1);
        const c2 = map(segment.c2);
        const p = map(segment.p);
        operators.push(appendBezierCurve(c1.x, c1.y, c2.x, c2.y, p.x, p.y));
        break;
      }
      default:
        operators.push(closePath());
    }
  }
  return operators;
}

/** 角丸矩形のパス。半径は PDF ポイント。 */
function roundedRectPath(
  rect: NormalizedRect,
  radiusPt: number,
  view: { width: number; height: number },
): PathSegment[] {
  const rx = Math.min(radiusPt / view.width, rect.w / 2);
  const ry = Math.min(radiusPt / view.height, rect.h / 2);

  if (rx <= 0 || ry <= 0) {
    return [
      { kind: "M", p: { x: rect.x, y: rect.y } },
      { kind: "L", p: { x: rect.x + rect.w, y: rect.y } },
      { kind: "L", p: { x: rect.x + rect.w, y: rect.y + rect.h } },
      { kind: "L", p: { x: rect.x, y: rect.y + rect.h } },
      { kind: "Z" },
    ];
  }

  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  const cx = rx * KAPPA;
  const cy = ry * KAPPA;

  return [
    { kind: "M", p: { x: left + rx, y: top } },
    { kind: "L", p: { x: right - rx, y: top } },
    {
      kind: "C",
      c1: { x: right - rx + cx, y: top },
      c2: { x: right, y: top + ry - cy },
      p: { x: right, y: top + ry },
    },
    { kind: "L", p: { x: right, y: bottom - ry } },
    {
      kind: "C",
      c1: { x: right, y: bottom - ry + cy },
      c2: { x: right - rx + cx, y: bottom },
      p: { x: right - rx, y: bottom },
    },
    { kind: "L", p: { x: left + rx, y: bottom } },
    {
      kind: "C",
      c1: { x: left + rx - cx, y: bottom },
      c2: { x: left, y: bottom - ry + cy },
      p: { x: left, y: bottom - ry },
    },
    { kind: "L", p: { x: left, y: top + ry } },
    {
      kind: "C",
      c1: { x: left, y: top + ry - cy },
      c2: { x: left + rx - cx, y: top },
      p: { x: left + rx, y: top },
    },
    { kind: "Z" },
  ];
}

/** 楕円のパス（ベジェ 4 本）。 */
function ellipsePath(rect: NormalizedRect): PathSegment[] {
  const rx = rect.w / 2;
  const ry = rect.h / 2;
  const cx = rect.x + rx;
  const cy = rect.y + ry;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;

  return [
    { kind: "M", p: { x: cx, y: cy - ry } },
    {
      kind: "C",
      c1: { x: cx + ox, y: cy - ry },
      c2: { x: cx + rx, y: cy - oy },
      p: { x: cx + rx, y: cy },
    },
    {
      kind: "C",
      c1: { x: cx + rx, y: cy + oy },
      c2: { x: cx + ox, y: cy + ry },
      p: { x: cx, y: cy + ry },
    },
    {
      kind: "C",
      c1: { x: cx - ox, y: cy + ry },
      c2: { x: cx - rx, y: cy + oy },
      p: { x: cx - rx, y: cy },
    },
    {
      kind: "C",
      c1: { x: cx - rx, y: cy - oy },
      c2: { x: cx - ox, y: cy - ry },
      p: { x: cx, y: cy - ry },
    },
    { kind: "Z" },
  ];
}

/**
 * 筆圧つきフリーハンドの輪郭を作る。
 *
 * 線幅を途中で変えることは stroke ではできないので、左右へ振った点を
 * つないだ閉じた図形として塗る。プレビュー (SVG) と書き出しで同じ関数を
 * 使うため、見た目が一致する。
 */
export function penOutline(
  points: PenPoint[],
  strokeWidth: number,
  view: { width: number; height: number },
): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const previous = points[i - 1] ?? points[i];
    const next = points[i + 1] ?? points[i];

    // 前後の点から進行方向を取り、その法線方向へ太さの半分だけ振る。
    const dx = (next.x - previous.x) * view.width;
    const dy = (next.y - previous.y) * view.height;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;

    // 筆圧 0.5 を基準に、0.35〜1.15 倍の範囲で太さを変える。
    const pressure = points[i].p ?? 0.5;
    const half = (strokeWidth * (0.35 + 1.6 * pressure)) / 2;

    const offsetX = (nx * half) / view.width;
    const offsetY = (ny * half) / view.height;

    left.push({ x: points[i].x + offsetX, y: points[i].y + offsetY });
    right.push({ x: points[i].x - offsetX, y: points[i].y - offsetY });
  }

  return [...left, ...right.reverse()];
}

/** 矢印の先端（三角形）の頂点を正規化座標で返す。 */
export function arrowHeadPoints(
  start: Point,
  end: Point,
  strokeWidth: number,
  view: { width: number; height: number },
): Point[] {
  const dx = (end.x - start.x) * view.width;
  const dy = (end.y - start.y) * view.height;
  const angle = Math.atan2(dy, dx);

  const length = Math.max(6, strokeWidth * 3.5);
  const halfWidth = Math.max(3, strokeWidth * 2);

  const toNormalized = (px: number, py: number): Point => ({
    x: end.x + px / view.width,
    y: end.y + py / view.height,
  });

  return [
    end,
    toNormalized(
      -length * Math.cos(angle) + halfWidth * Math.sin(angle),
      -length * Math.sin(angle) - halfWidth * Math.cos(angle),
    ),
    toNormalized(
      -length * Math.cos(angle) - halfWidth * Math.sin(angle),
      -length * Math.sin(angle) + halfWidth * Math.cos(angle),
    ),
  ];
}

function polygonPath(points: Point[]): PathSegment[] {
  if (points.length === 0) return [];
  return [
    { kind: "M", p: points[0] },
    ...points.slice(1).map((p) => ({ kind: "L" as const, p })),
    { kind: "Z" },
  ];
}

function polylinePath(points: Point[]): PathSegment[] {
  if (points.length === 0) return [];
  return [
    { kind: "M", p: points[0] },
    ...points.slice(1).map((p) => ({ kind: "L" as const, p })),
  ];
}

// ---------------------------------------------------------------------------
// 要素 → オペレータ列
// ---------------------------------------------------------------------------

/** 要素 1 つを描くためのオペレータ列を組み立てる。 */
export function buildElementOperators(
  element: EditorElement,
  resources: DrawResources,
): PDFOperator[] {
  const { geo } = resources;

  if (element.type === "text") {
    return buildTextOperators(element, resources);
  }

  if (element.type === "image") {
    return buildImageOperators(element, resources);
  }

  const rect = elementGeometryRect(element);
  const center = rectCenter(rect);
  const rotation = element.rotation;

  const emit = (
    segments: PathSegment[],
    style: {
      fill?: string | null;
      stroke?: string | null;
      strokeWidth?: number;
      opacity: number;
      blendMode?: string;
      lineCap?: LineCapStyle;
    },
  ): PDFOperator[] => {
    const hasFill = Boolean(style.fill);
    const hasStroke = Boolean(style.stroke) && (style.strokeWidth ?? 0) > 0;
    if (!hasFill && !hasStroke) return [];

    const gs = resources.graphicsState({
      opacity: hasFill ? style.opacity : undefined,
      borderOpacity: hasStroke ? style.opacity : undefined,
      blendMode: style.blendMode,
    });

    const operators: PDFOperator[] = [pushGraphicsState()];
    if (gs) operators.push(setGraphicsState(gs));

    if (hasFill) {
      const { r, g, b } = hexToRgb01(style.fill as string);
      operators.push(setFillingColor(rgb(r, g, b)));
    }
    if (hasStroke) {
      const { r, g, b } = hexToRgb01(style.stroke as string);
      operators.push(
        setStrokingColor(rgb(r, g, b)),
        setLineWidth(style.strokeWidth as number),
        setLineCap(style.lineCap ?? LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
      );
    }

    operators.push(...pathToOperators(segments, geo, rotation, center));
    operators.push(
      hasFill && hasStroke ? fillAndStroke() : hasFill ? fill() : stroke(),
    );
    operators.push(popGraphicsState());
    return operators;
  };

  switch (element.type) {
    case "highlight":
      return emit(roundedRectPath(rect, 0, geo.view), {
        fill: element.color,
        opacity: element.opacity,
        // 乗算合成にすると、下にある文字が透けて本物の蛍光ペンに見える。
        blendMode: "Multiply",
      });

    case "rect":
      return emit(roundedRectPath(rect, element.radius, geo.view), {
        fill: element.fill,
        stroke: element.stroke,
        strokeWidth: element.strokeWidth,
        opacity: element.opacity,
      });

    case "ellipse":
      return emit(ellipsePath(rect), {
        fill: element.fill,
        stroke: element.stroke,
        strokeWidth: element.strokeWidth,
        opacity: element.opacity,
      });

    case "arrow": {
      const start = { x: element.x1, y: element.y1 };
      const end = { x: element.x2, y: element.y2 };
      const operators = emit(polylinePath([start, end]), {
        stroke: element.color,
        strokeWidth: element.strokeWidth,
        opacity: element.opacity,
      });
      if (!element.head) return operators;

      const head = arrowHeadPoints(
        start,
        end,
        element.strokeWidth,
        geo.view,
      );
      return [
        ...operators,
        ...emit(polygonPath(head), {
          fill: element.color,
          opacity: element.opacity,
        }),
      ];
    }

    default: {
      // フリーハンド。筆圧つきのときは輪郭を塗り、そうでなければ線を引く。
      if (element.points.length < 2) return [];
      if (element.pressure) {
        return emit(
          polygonPath(penOutline(element.points, element.strokeWidth, geo.view)),
          { fill: element.color, opacity: element.opacity },
        );
      }
      return emit(polylinePath(element.points), {
        stroke: element.color,
        strokeWidth: element.strokeWidth,
        opacity: element.opacity,
      });
    }
  }
}

/** 回転の軸となる矩形を返す（回転していない状態の枠）。 */
function elementGeometryRect(element: EditorElement): NormalizedRect {
  if (isBoxElement(element)) {
    return { x: element.x, y: element.y, w: element.w, h: element.h };
  }
  if (element.type === "arrow") {
    return {
      x: Math.min(element.x1, element.x2),
      y: Math.min(element.y1, element.y2),
      w: Math.abs(element.x2 - element.x1),
      h: Math.abs(element.y2 - element.y1),
    };
  }
  if (element.type === "pen") {
    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function buildTextOperators(
  element: Extract<EditorElement, { type: "text" }>,
  resources: DrawResources,
): PDFOperator[] {
  const { geo } = resources;
  const { font, name } = resources.font(element.fontWeight);
  const metrics = resources.fonts.get(element.fontWeight);

  const layout = layoutTextBlock(
    element.text,
    element.fontSize,
    metrics,
    element.width === null ? null : element.width * geo.view.width,
  );

  const { r, g, b } = hexToRgb01(element.color);
  const gs = resources.graphicsState({ opacity: element.opacity });

  const rect: NormalizedRect = {
    x: element.x,
    y: element.y,
    w: layout.width / geo.view.width,
    h: layout.height / geo.view.height,
  };
  const center = rectCenter(rect);

  const operators: PDFOperator[] = [];

  layout.lines.forEach((line, index) => {
    if (line.length === 0) return;

    // 行揃えは行ごとに開始位置をずらして表現する。
    const lineWidth = metrics.measureText(line, element.fontSize);
    const offset =
      element.align === "center"
        ? (layout.width - lineWidth) / 2
        : element.align === "right"
          ? layout.width - lineWidth
          : 0;

    const baselineNormalized: Point = {
      x: element.x + offset / geo.view.width,
      y: element.y + layout.baselineOffsets[index] / geo.view.height,
    };
    const rotated =
      element.rotation === 0
        ? baselineNormalized
        : rotatePoint(baselineNormalized, center, element.rotation, geo.view);
    const origin = normalizedToPdf(geo, rotated.x, rotated.y);

    operators.push(
      ...drawLinesOfText([font.encodeText(line)], {
        color: rgb(r, g, b),
        font: name,
        size: element.fontSize,
        // ページの /Rotate は時計回り、pdf-lib の rotate は反時計回りで
        // 打ち消し合う。要素自身の回転は画面上の時計回りなので符号を反転する。
        rotate: degrees(geo.rotation - element.rotation),
        xSkew: degrees(element.italic ? ITALIC_SKEW_DEGREES : 0),
        ySkew: degrees(0),
        x: origin.x,
        y: origin.y,
        lineHeight: LINE_HEIGHT_FACTOR * element.fontSize,
        graphicsState: gs,
      }),
    );
  });

  return operators;
}

function buildImageOperators(
  element: Extract<EditorElement, { type: "image" }>,
  resources: DrawResources,
): PDFOperator[] {
  const { geo } = resources;
  const image = resources.image(element.assetId);
  if (!image) return [];

  const rect: NormalizedRect = {
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
  };
  const center = rectCenter(rect);

  // 画像は「単位正方形を変換行列で置く」形なので、左下・右下・左上の
  // 3 点を PDF 座標へ移してから行列を組み立てる。回転もこれで表現できる。
  const toPdf = (nx: number, ny: number) => {
    const point =
      element.rotation === 0
        ? { x: nx, y: ny }
        : rotatePoint({ x: nx, y: ny }, center, element.rotation, geo.view);
    return normalizedToPdf(geo, point.x, point.y);
  };

  const bottomLeft = toPdf(rect.x, rect.y + rect.h);
  const bottomRight = toPdf(rect.x + rect.w, rect.y + rect.h);
  const topLeft = toPdf(rect.x, rect.y);

  const a = bottomRight.x - bottomLeft.x;
  const b = bottomRight.y - bottomLeft.y;
  const c = topLeft.x - bottomLeft.x;
  const d = topLeft.y - bottomLeft.y;

  const gs = resources.graphicsState({ opacity: element.opacity });

  const operators: PDFOperator[] = [pushGraphicsState()];
  if (gs) operators.push(setGraphicsState(gs));
  operators.push(
    concatMatrix(a, b, c, d, bottomLeft.x, bottomLeft.y),
    drawXObject(image.name),
    popGraphicsState(),
  );
  return operators;
}

function concatMatrix(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
): PDFOperator {
  return concatTransformationMatrix(a, b, c, d, e, f);
}

function drawXObject(name: PDFName): PDFOperator {
  return drawObject(name.asString().replace(/^\//, ""));
}
