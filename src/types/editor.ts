/** ツールバーで選べる道具。 */
export type ToolId =
  | "select"
  | "text"
  | "highlight"
  | "rect"
  | "ellipse"
  | "arrow"
  | "pen"
  | "image"
  | "callout"
  | "textEdit";

/** 図形を描くツール（ドラッグして作るもの）。 */
export const DRAW_TOOLS = [
  "highlight",
  "rect",
  "ellipse",
  "arrow",
  "pen",
  "callout",
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
  /** 要素自身の回転角（度・時計回り）。中心を軸に回す。 */
  rotation: number;
  /** true の間は選択もドラッグもできない。 */
  locked: boolean;
  /** 同じ値を持つ要素はまとめて選択・移動される。 */
  groupId: string | null;
  /** false にすると画面にも出力にも描かれない（レイヤー一覧から切り替える）。 */
  visible: boolean;
  /** レイヤー一覧に出す名前。未設定なら種類から自動で決める。 */
  name?: string;
  /** レビュー用のコメント。PDF注釈として書き出すと返信ごと持ち出せる。 */
  comment?: CommentThread;
}

/** 注釈に付けるコメントと、その返信。 */
export interface CommentThread {
  author: string;
  text: string;
  createdAt: number;
  replies: CommentReply[];
  /** 解決済みにすると一覧で畳まれる。 */
  resolved: boolean;
}

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

/** 矩形で位置と大きさが決まる要素。左上が (x, y)。 */
interface BoxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FontWeight = "regular" | "bold";

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
  fontWeight: FontWeight;
  /** 疑似イタリック。日本語フォントに斜体が無いため字送りを傾けて表現する。 */
  italic: boolean;
  /** 縦書き。行は右から左へ進む。 */
  vertical: boolean;
  /** ぶら下げ組。行末の句読点を版面の外へ出す。 */
  hanging: boolean;
  /**
   * 折り返し幅（正規化）。null なら折り返さず、改行だけで行が決まる。
   * 値があるときはこの幅で自動折り返しし、日本語の禁則処理も適用する。
   */
  width: number | null;
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

/** フリーハンドの 1 点。`p` は筆圧 (0〜1)。 */
export interface PenPoint {
  x: number;
  y: number;
  p?: number;
}

export interface PenElement extends ElementBase {
  type: "pen";
  points: PenPoint[];
  color: string;
  strokeWidth: number;
  /** 筆圧に応じて線幅を変える。ペン入力で描いたときに有効になる。 */
  pressure: boolean;
}

export interface ImageElement extends ElementBase, BoxGeometry {
  type: "image";
  /** `ImageAssetStore` のキー。画像本体は履歴に載せない。 */
  assetId: string;
}

/**
 * 吹き出し。文字の入った枠と、指し先へ伸びる引き出し線をひとまとめにする。
 * 枠を動かすと線が追従する。
 */
export interface CalloutElement extends ElementBase, BoxGeometry {
  type: "callout";
  /** 指し先の正規化座標。 */
  targetX: number;
  targetY: number;
  text: string;
  fontSize: number;
  color: string;
  fontWeight: FontWeight;
  /** 枠の塗りと線。 */
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

export type EditorElement =
  | TextElement
  | RectElement
  | EllipseElement
  | HighlightElement
  | ArrowElement
  | PenElement
  | ImageElement
  | CalloutElement;

export type ElementType = EditorElement["type"];

/** 矩形で大きさが決まる要素かどうか。 */
export function isBoxElement(
  element: EditorElement,
): element is
  | RectElement
  | EllipseElement
  | HighlightElement
  | ImageElement
  | CalloutElement {
  return (
    element.type === "rect" ||
    element.type === "ellipse" ||
    element.type === "highlight" ||
    element.type === "image" ||
    element.type === "callout"
  );
}

/** 文字を持つ要素かどうか。 */
export function hasText(
  element: EditorElement,
): element is TextElement | CalloutElement {
  return element.type === "text" || element.type === "callout";
}

/** 塗り・枠線を持つ図形かどうか。 */
export function isShapeElement(
  element: EditorElement,
): element is RectElement | EllipseElement {
  return element.type === "rect" || element.type === "ellipse";
}

/** ページに対して 90 度単位で加える回転量。 */
export type RotationDelta = 0 | 90 | 180 | 270;

/** 編集後のドキュメントに残っている 1 ページ分の状態。 */
export interface PageState {
  /**
   * 元 PDF における 0 始まりのページ番号。並べ替えても変わらない。
   * `-1` なら元ページを持たない白紙ページ。
   */
  sourceIndex: number;
  /**
   * どの読み込み済みファイル由来か。PDF 結合に対応するため、
   * ページごとに出どころを持つ。白紙ページでは空文字。
   */
  sourceId: string;
  /** 元 PDF のページ回転に対して、エディタ上で追加した時計回りの回転量。 */
  rotation: RotationDelta;
  /** 白紙ページの寸法（PDFポイント）。`sourceIndex < 0` のときだけ使う。 */
  blankSize?: PageSize;
  /**
   * 表示・書き出しに使う切り抜き。表示中のページに対する比率で持つ。
   * 設定すると、この範囲だけが 1 ページとして扱われる。
   */
  crop?: NormalizedRect;
  /** 用紙サイズの変更先（PDFポイント）。中身は収まるよう拡大縮小される。 */
  resizeTo?: PageSize;
}

/** 元ページを持たない白紙ページか。 */
export function isBlankPage(page: PageState): boolean {
  return page.sourceIndex < 0;
}

/** よく使う用紙サイズ（ポイント）。 */
export const PAPER_SIZES: { label: string; size: PageSize }[] = [
  { label: "A4 縦", size: { width: 595.28, height: 841.89 } },
  { label: "A4 横", size: { width: 841.89, height: 595.28 } },
  { label: "A3 縦", size: { width: 841.89, height: 1190.55 } },
  { label: "B5 縦", size: { width: 498.9, height: 708.66 } },
  { label: "Letter", size: { width: 612, height: 792 } },
];

/**
 * Undo / Redo の対象になる編集内容のすべて。
 * 元 PDF のバイト列と画像データはここには含めない。
 */
export interface EditorDoc {
  pages: PageState[];
  /** 配列の順序がそのまま重なり順（後ろの要素ほど手前）。 */
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

export interface Point {
  x: number;
  y: number;
}
