/** ツールバーで選べる道具。 */
export type ToolId =
  | "select"
  | "text"
  | "highlight"
  | "rect"
  | "ellipse"
  | "arrow"
  | "pen"
  | "image";

/** 図形を描くツール（ドラッグして作るもの）。 */
export const DRAW_TOOLS = [
  "highlight",
  "rect",
  "ellipse",
  "arrow",
  "pen",
] as const;

export type DrawToolId = (typeof DRAW_TOOLS)[number];

/**
 * すべての要素に共通する項目。
 *
 * 座標はページ表示サイズに対する比率 (0〜1) で持つ。ズーム率・
 * ウィンドウ幅・デバイスピクセル比のいずれにも依存しない。
 */
interface ElementBase {
  id: string;
  /** `EditorDoc.pages` 内でのページ位置（表示順）。 */
  pageIndex: number;
  /** 0〜1。 */
  opacity: number;
}

/** 矩形で位置と大きさが決まる要素。左上が (x, y)。 */
interface BoxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextElement extends ElementBase {
  type: "text";
  /** テキストブロック左上の正規化座標。 */
  x: number;
  y: number;
  text: string;
  /** PDFポイント (1/72インチ)。拡大縮小するとこの値が変わる。 */
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
}

export interface RectElement extends ElementBase, BoxGeometry {
  type: "rect";
  /** null なら塗りなし。 */
  fill: string | null;
  /** null なら枠線なし。 */
  stroke: string | null;
  /** PDFポイント。 */
  strokeWidth: number;
  /** 角丸の半径 (PDFポイント)。 */
  radius: number;
}

export interface EllipseElement extends ElementBase, BoxGeometry {
  type: "ellipse";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

/** 蛍光ペン。乗算合成で下の文字を透かす。 */
export interface HighlightElement extends ElementBase, BoxGeometry {
  type: "highlight";
  color: string;
}

export interface ArrowElement extends ElementBase {
  type: "arrow";
  /** 始点と終点の正規化座標。 */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
  /** false なら矢印の頭を描かない（ただの直線）。 */
  head: boolean;
}

export interface PenElement extends ElementBase {
  type: "pen";
  /** 通過点の正規化座標。 */
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
}

export interface ImageElement extends ElementBase, BoxGeometry {
  type: "image";
  /** `ImageAssetStore` のキー。画像本体は履歴に載せない。 */
  assetId: string;
}

export type EditorElement =
  | TextElement
  | RectElement
  | EllipseElement
  | HighlightElement
  | ArrowElement
  | PenElement
  | ImageElement;

export type ElementType = EditorElement["type"];

/** 矩形で大きさが決まる要素かどうか。 */
export function isBoxElement(
  element: EditorElement,
): element is RectElement | EllipseElement | HighlightElement | ImageElement {
  return (
    element.type === "rect" ||
    element.type === "ellipse" ||
    element.type === "highlight" ||
    element.type === "image"
  );
}

/** ページに対して 90 度単位で加える回転量。 */
export type RotationDelta = 0 | 90 | 180 | 270;

/** 編集後のドキュメントに残っている 1 ページ分の状態。 */
export interface PageState {
  /** 元 PDF における 0 始まりのページ番号。並べ替えても変わらない。 */
  sourceIndex: number;
  /** 元 PDF のページ回転に対して、エディタ上で追加した時計回りの回転量。 */
  rotation: RotationDelta;
}

/**
 * Undo / Redo の対象になる編集内容のすべて。
 * 元 PDF のバイト列と画像データはここには含めない。
 */
export interface EditorDoc {
  pages: PageState[];
  elements: EditorElement[];
}

/** ページ 1 枚の寸法。単位は PDF ポイント。 */
export interface PageSize {
  width: number;
  height: number;
}

/** 正規化された矩形。 */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
