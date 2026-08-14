import type { FontMetrics, LoadedFont } from "./font";
import type { TextElement } from "@/types/editor";

/**
 * テキストの組み方の定義
 * ------------------------------------------------------------------
 * プレビュー (SVG) と書き出し (pdf-lib) の位置を一致させるため、
 * 「1 行目のベースラインはどこか」「ブロックの高さはいくつか」を
 * ブラウザのラインボックス計算に **頼らず** ここだけで決める。
 *
 *   ┌──────────────── y (要素の上端)
 *   │   ↕ ascentRatio × fontSize
 *   ├──────────────── 1 行目のベースライン
 *   │   ↕ LINE_HEIGHT_FACTOR × fontSize
 *   ├──────────────── 2 行目のベースライン
 *   │   ↕ descentRatio × fontSize
 *   └──────────────── ブロックの下端
 *
 * SVG の <text> は y にベースラインを取るので、この計算をそのまま渡せる。
 * pdf-lib の drawText も同じくベースライン基準なので、両者は一致する。
 */
export const LINE_HEIGHT_FACTOR = 1.25;

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 100;
export const DEFAULT_FONT_SIZE = 18;
export const DEFAULT_TEXT = "テキストを入力";
export const DEFAULT_COLOR = "#111827";

/** 1 要素分のレイアウト結果。単位はすべて PDF ポイント。 */
export interface TextBlockLayout {
  lines: string[];
  /** 要素上端から各行のベースラインまでの距離。 */
  baselineOffsets: number[];
  /** 最も長い行の幅。 */
  width: number;
  /** ブロック全体の高さ。 */
  height: number;
}

/**
 * pdf-lib が描画直前に内部で行う正規化を、入力の時点で先に適用する。
 * これをしないとタブ文字などでプレビューと出力の幅がずれる。
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u0085\u2028\u2029]/g, "    ")
    .replace(/[\b\v\f]/g, "");
}

export function splitLines(text: string): string[] {
  // 空文字でも 1 行として扱う（高さ 0 の要素を作らないため）。
  return text.length === 0 ? [""] : text.split("\n");
}

export function layoutTextBlock(
  text: string,
  fontSize: number,
  font: LoadedFont,
): TextBlockLayout {
  const lines = splitLines(text);
  const { ascentRatio, descentRatio } = font.metrics;

  const baselineOffsets = lines.map(
    (_, index) => ascentRatio * fontSize + index * LINE_HEIGHT_FACTOR * fontSize,
  );

  const width = lines.reduce(
    (max, line) => Math.max(max, font.measureText(line, fontSize)),
    0,
  );

  const height =
    (ascentRatio + descentRatio) * fontSize +
    (lines.length - 1) * LINE_HEIGHT_FACTOR * fontSize;

  return { lines, baselineOffsets, width, height };
}

/**
 * フォント未読み込み時に使う概算メトリクス。
 * 実測値に置き換わるまでの一瞬だけ使われる。
 */
export const FALLBACK_METRICS: FontMetrics = {
  unitsPerEm: 1000,
  ascentRatio: 1.16,
  descentRatio: 0.288,
};

/**
 * 要素の外接矩形をビュー座標 (ポイント) で返す。
 * 選択枠の描画とドラッグ範囲の制限に使う。
 */
export function elementBounds(
  element: TextElement,
  viewWidth: number,
  viewHeight: number,
  font: LoadedFont,
): { x: number; y: number; width: number; height: number } {
  const layout = layoutTextBlock(element.text, element.fontSize, font);
  return {
    x: element.x * viewWidth,
    y: element.y * viewHeight,
    width: layout.width,
    height: layout.height,
  };
}
