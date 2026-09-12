import type { FontMetrics, LoadedFont } from "./font";
import type { CalloutElement, TextElement } from "@/types/editor";

/**
 * テキストの組み方
 * ------------------------------------------------------------------
 * プレビュー (SVG) と書き出し (pdf-lib) の位置を一致させるため、
 * 1 文字ずつの置き場所をここだけで決める。ブラウザの行送りや
 * 文字詰めの実装には一切頼らない。
 *
 *   ┌──────────────── y (要素の上端)
 *   │   ↕ ascentRatio × fontSize
 *   ├──────────────── 1 行目のベースライン
 *   │   ↕ LINE_HEIGHT_FACTOR × fontSize
 *   ├──────────────── 2 行目のベースライン
 *   │   ↕ descentRatio × fontSize
 *   └──────────────── ブロックの下端
 *
 * 縦書きのときは行が右から左へ進み、文字は上から下へ積まれる。
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

/**
 * 文字詰め（アキ調整）の対象
 * ------------------------------------------------------------------
 * 和文の約物は全角幅で作られているが、実際の組版では前後のアキを
 * 詰める。JIS X 4051 に倣い、次の 3 種類を半角ぶん詰める。
 *   - 終わり括弧・句読点: 右側のアキを詰める
 *   - 始め括弧: 左側のアキを詰める
 *   - 中点: 左右を四分ずつ詰める
 */
const CLOSING_PUNCTUATION = "、。，．）］｝〉》」』】〕｠〟’”";
const OPENING_PUNCTUATION = "（［｛〈《「『【〔｟〝‘“";
const MIDDLE_DOT = "・：；";

/** 縦書きで字形を 90 度回さないと向きが合わない文字。 */
const VERTICAL_ROTATED =
  "ー〜～…‥−–—―（）［］｛｝〈〉《》「」『』【】〔〕｟｠(){}[]<>";

/** 縦書きで字面を右上へ寄せる文字（句読点・小書き仮名）。 */
const VERTICAL_SHIFTED = "、。，．ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ";

/** 1 文字の置き場所。原点は行のベースライン（縦書きでは行の中心線）。 */
export interface GlyphPosition {
  char: string;
  /** ブロック左上からのオフセット（ポイント）。 */
  x: number;
  y: number;
  /** 縦書きで字形を 90 度回すか。 */
  rotated: boolean;
}

export interface TextLine {
  text: string;
  glyphs: GlyphPosition[];
  /** 行の長さ（横書きなら幅、縦書きなら高さ）。 */
  advance: number;
}

/** 1 要素分のレイアウト結果。単位はすべて PDF ポイント。 */
export interface TextBlockLayout {
  lines: TextLine[];
  /** ブロックの幅。 */
  width: number;
  /** ブロックの高さ。 */
  height: number;
  vertical: boolean;
}

export interface TextLayoutOptions {
  /** 折り返し幅（横書き）／折り返し高さ（縦書き）。null なら折り返さない。 */
  wrapSize?: number | null;
  align?: "left" | "center" | "right";
  vertical?: boolean;
  /** ぶら下げ組。行末の句読点を版面の外へ出す。 */
  hanging?: boolean;
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
 * 文字詰めの量を返す（前アキ・後アキ、ポイント）。
 * 和文の約物だけを対象にし、欧文には手を入れない。
 */
function spacingFor(
  char: string,
  fontSize: number,
): { before: number; after: number } {
  const half = fontSize / 2;
  const quarter = fontSize / 4;

  if (CLOSING_PUNCTUATION.includes(char)) return { before: 0, after: -half };
  if (OPENING_PUNCTUATION.includes(char)) return { before: -half, after: 0 };
  if (MIDDLE_DOT.includes(char)) return { before: -quarter, after: -quarter };
  return { before: 0, after: 0 };
}

/** ぶら下げの対象（行末に来たとき版面の外へ出す文字）。 */
function isHangable(char: string): boolean {
  return "、。，．".includes(char);
}

/** 1 段落を折り返し可能な最小単位へ分解する。 */
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

/** 文字列の送り幅を、文字詰めを含めて測る。 */
function measureRun(
  text: string,
  fontSize: number,
  font: LoadedFont,
  vertical: boolean,
): number {
  if (vertical) {
    // 縦書きは全角ぶんずつ積む。詰めは句読点のみに効かせる。
    let total = 0;
    for (const char of text) {
      const spacing = spacingFor(char, fontSize);
      total += fontSize + spacing.before + spacing.after;
    }
    return total;
  }

  let total = 0;
  for (const char of text) {
    const spacing = spacingFor(char, fontSize);
    total += font.measureText(char, fontSize) + spacing.before + spacing.after;
  }
  return total;
}

/**
 * 禁則処理つきの折り返し。
 *
 * 行頭に来てはいけない文字が次行の先頭に来る場合、直前の文字も次行へ送る
 * （追い出し）。ぶら下げが有効なときは、句読点 1 文字ぶんは溢れを許す。
 */
function wrapParagraph(
  paragraph: string,
  fontSize: number,
  font: LoadedFont,
  maxSize: number,
  vertical: boolean,
  hanging: boolean,
): string[] {
  if (paragraph.length === 0) return [""];

  const tokens = tokenize(paragraph);
  const lines: string[] = [];
  let current: string[] = [];

  const sizeOf = (parts: string[]) =>
    measureRun(parts.join(""), fontSize, font, vertical);

  const flush = () => {
    if (current.length === 0) return;
    lines.push(current.join(""));
    current = [];
  };

  for (const token of tokens) {
    if (current.length === 0 && token === " ") continue;

    current.push(token);

    // ぶら下げ対象の約物は、はみ出しても行に留める。
    if (hanging && token.length === 1 && isHangable(token)) continue;
    if (sizeOf(current) <= maxSize || current.length === 1) continue;

    const overflow = [current.pop() as string];

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
 * テキストを行と文字位置へ割り付ける。
 *
 * `wrapSize` を渡すとその大きさで自動折り返しする。単位は PDF ポイント。
 */
export function layoutTextBlock(
  text: string,
  fontSize: number,
  font: LoadedFont,
  options: TextLayoutOptions = {},
): TextBlockLayout {
  const {
    wrapSize = null,
    align = "left",
    vertical = false,
    hanging = false,
  } = options;

  const paragraphs = splitLines(text);
  const rawLines =
    wrapSize && wrapSize > 0
      ? paragraphs.flatMap((paragraph) =>
          wrapParagraph(
            paragraph,
            fontSize,
            font,
            wrapSize,
            vertical,
            hanging,
          ),
        )
      : paragraphs;

  const { ascentRatio, descentRatio } = font.metrics;
  const lineStep = LINE_HEIGHT_FACTOR * fontSize;

  // 行の長さ（横書きは幅、縦書きは高さ）。
  const advances = rawLines.map((line) =>
    measureRun(line, fontSize, font, vertical),
  );
  const longest = Math.max(0, ...advances);
  const runSize = wrapSize && wrapSize > 0 ? wrapSize : longest;

  const lines: TextLine[] = rawLines.map((line, lineIndex) => {
    const advance = advances[lineIndex];

    // 行揃えのぶんだけ開始位置をずらす。
    const offset =
      align === "center"
        ? (runSize - advance) / 2
        : align === "right"
          ? runSize - advance
          : 0;

    const glyphs: GlyphPosition[] = [];
    let cursor = offset;

    for (const char of line) {
      const spacing = spacingFor(char, fontSize);
      cursor += spacing.before;

      if (vertical) {
        // 縦書き: 行は右から左へ。文字は行の中心に置き、上から下へ積む。
        const columnCenter =
          runSizeForVertical(rawLines.length, lineStep) -
          lineIndex * lineStep -
          lineStep / 2;
        const rotated = VERTICAL_ROTATED.includes(char);
        const shifted = VERTICAL_SHIFTED.includes(char);

        glyphs.push({
          char,
          // 中心から半分ぶん左へ寄せると、字面が列の中心に来る。
          x:
            columnCenter -
            fontSize / 2 +
            (shifted ? fontSize * 0.5 : 0),
          y: cursor + (shifted ? -fontSize * 0.4 : 0) + ascentRatio * fontSize,
          rotated,
        });
        cursor += fontSize + spacing.after;
      } else {
        glyphs.push({
          char,
          x: cursor,
          y: ascentRatio * fontSize + lineIndex * lineStep,
          rotated: false,
        });
        cursor += font.measureText(char, fontSize) + spacing.after;
      }
    }

    return { text: line, glyphs, advance };
  });

  const blockThickness =
    (ascentRatio + descentRatio) * fontSize + (rawLines.length - 1) * lineStep;

  return {
    lines,
    width: vertical ? rawLines.length * lineStep : runSize,
    height: vertical ? runSize : blockThickness,
    vertical,
  };
}

/** 縦書きの版面幅（行数 × 行送り）。 */
function runSizeForVertical(lineCount: number, lineStep: number): number {
  return lineCount * lineStep;
}

/** 吹き出しの枠と文字のあいだの余白（ポイント）。 */
export const CALLOUT_PADDING = 8;

/**
 * 要素の設定からレイアウトを求める。
 * プレビューと書き出しで同じ結果を得るため、必ずこの関数を通す。
 */
export function textLayoutFor(
  element: TextElement | CalloutElement,
  font: LoadedFont,
  view: { width: number; height: number },
): TextBlockLayout {
  if (element.type === "callout") {
    // 吹き出しの文字は枠の内側に収める。
    return layoutTextBlock(element.text, element.fontSize, font, {
      wrapSize: Math.max(1, element.w * view.width - CALLOUT_PADDING * 2),
      align: "left",
    });
  }

  return layoutTextBlock(element.text, element.fontSize, font, {
    // 縦書きの折り返しは「列の高さ」なので、ページの高さを基準にする。
    wrapSize:
      element.width === null
        ? null
        : element.width * (element.vertical ? view.height : view.width),
    align: element.align,
    vertical: element.vertical,
    hanging: element.hanging,
  });
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
