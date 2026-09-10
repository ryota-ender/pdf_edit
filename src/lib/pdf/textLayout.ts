import type { FontMetrics, LoadedFont } from "./font";

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
export const MAX_FONT_SIZE = 200;
export const DEFAULT_FONT_SIZE = 18;
export const DEFAULT_TEXT = "テキストを入力";
export const DEFAULT_COLOR = "#111827";

/** 行頭に置いてはいけない文字（閉じ括弧・句読点・長音・小書き仮名など）。 */
const NO_LINE_START =
  "、。，．・：；？！゛゜ヽヾゝゞー" +
  ")]}）］｝〕〉》」』】〙〗〟｠" +
  "ぁぃぅぇぉっゃゅょゎ" +
  "ァィゥェォッャュョヮ" +
  "ヵヶ–—‐～％‰℃’”";

/** 行末に置いてはいけない文字（開き括弧など）。 */
const NO_LINE_END = "([{（［｛〔〈《「『【〘〖〝｟‘“";

/** 単語として途中で割ってはいけない文字（英数字とラテン文字）。 */
const WORD_CHAR = /[0-9A-Za-zÀ-ÖØ-öø-ÿ'’.,]/;

/** 1 要素分のレイアウト結果。単位はすべて PDF ポイント。 */
export interface TextBlockLayout {
  lines: string[];
  /** 要素上端から各行のベースラインまでの距離。 */
  baselineOffsets: number[];
  /** 最も長い行の幅。折り返し時は折り返し幅そのもの。 */
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

/**
 * 1 段落を折り返し可能な最小単位へ分解する。
 * 英数字の連なりは 1 語としてまとめ、それ以外（CJK など）は 1 文字ずつ。
 */
function tokenize(paragraph: string): string[] {
  const tokens: string[] = [];
  let word = "";

  for (const char of paragraph) {
    if (WORD_CHAR.test(char)) {
      word += char;
      continue;
    }
    if (word) {
      tokens.push(word);
      word = "";
    }
    tokens.push(char);
  }
  if (word) tokens.push(word);
  return tokens;
}

/**
 * 禁則処理つきの折り返し。
 *
 * 行頭に来てはいけない文字が次行の先頭に来る場合、直前の文字も次行へ送る
 * （追い出し）。行末に来てはいけない文字が行末に残る場合も同様に送る。
 */
function wrapParagraph(
  paragraph: string,
  fontSize: number,
  font: LoadedFont,
  maxWidth: number,
): string[] {
  if (paragraph.length === 0) return [""];

  const tokens = tokenize(paragraph);
  const lines: string[] = [];
  let current: string[] = [];

  const widthOf = (parts: string[]) =>
    font.measureText(parts.join(""), fontSize);

  const flush = () => {
    if (current.length === 0) return;
    lines.push(current.join(""));
    current = [];
  };

  for (const token of tokens) {
    // 半角スペースは行頭に残さない。
    if (current.length === 0 && token === " ") continue;

    current.push(token);
    // 1 語しか無いのに溢れる場合は、割らずにそのまま行として確定させる。
    if (widthOf(current) <= maxWidth || current.length === 1) continue;

    // 幅を超えたので、今追加した分を次の行へ回す。
    const overflow = [current.pop() as string];

    // 追い出し。行が空になる手前で必ず打ち切る。
    let guard = 0;
    while (current.length > 1 && guard < 8) {
      const nextHead = overflow[0]?.[0] ?? "";
      const currentTail = current.at(-1) as string;
      const tailChar = currentTail.at(-1) ?? "";

      const startsBad = NO_LINE_START.includes(nextHead);
      const endsBad = NO_LINE_END.includes(tailChar);
      if (!startsBad && !endsBad) break;

      overflow.unshift(current.pop() as string);
      guard += 1;
    }

    flush();
    current = overflow;
  }

  flush();
  return lines.length > 0 ? lines : [""];
}

/**
 * テキストを行へ割り付ける。
 *
 * `wrapWidth` (PDFポイント) を渡すとその幅で自動折り返しする。
 * null のときは手動改行だけで行が決まる。
 */
export function layoutTextBlock(
  text: string,
  fontSize: number,
  font: LoadedFont,
  wrapWidth?: number | null,
): TextBlockLayout {
  const paragraphs = splitLines(text);

  const lines =
    wrapWidth && wrapWidth > 0
      ? paragraphs.flatMap((paragraph) =>
          wrapParagraph(paragraph, fontSize, font, wrapWidth),
        )
      : paragraphs;

  const { ascentRatio, descentRatio } = font.metrics;

  const baselineOffsets = lines.map(
    (_, index) => ascentRatio * fontSize + index * LINE_HEIGHT_FACTOR * fontSize,
  );

  const measured = lines.reduce(
    (max, line) => Math.max(max, font.measureText(line, fontSize)),
    0,
  );
  // 折り返し時は枠の幅がそのままブロック幅。行揃えの基準にもなる。
  const width = wrapWidth && wrapWidth > 0 ? wrapWidth : measured;

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
