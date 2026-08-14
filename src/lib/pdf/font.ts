import type { Font as FontkitFont, Subset as FontkitSubset } from "fontkit";
import { PdfEditorError } from "./errors";

/**
 * 日本語フォントの扱い
 * ------------------------------------------------------------------
 * プレビュー (SVG) と PDF 書き出し (pdf-lib) で **同一の TTF** を使う。
 * 同じフォントの同じメトリクスで文字送りを計算するので、画面上の位置と
 * 出力 PDF の位置が一致する。
 *
 * フォントは初回に必要になったタイミングで初めて取得する。5MB 強あるため、
 * PDF を開いただけの状態ではダウンロードしない。
 */

export const FONT_URL = "/fonts/NotoSansJP-Regular.ttf";
/** globals.css の @font-face と揃えること。 */
export const FONT_FAMILY = "NotoSansJPEmbedded";

export interface FontMetrics {
  unitsPerEm: number;
  /** em に対するアセンダの比率。ベースライン位置の算出に使う。 */
  ascentRatio: number;
  /** em に対するディセンダの比率 (正の値)。 */
  descentRatio: number;
}

export interface LoadedFont {
  metrics: FontMetrics;
  /**
   * 文字列の送り幅をポイント単位で返す。
   * pdf-lib の `widthOfTextAtSize` と同じく、カーニングを含まない
   * グリフの advanceWidth の総和で計算する（pdf-lib はグリフIDを並べる
   * だけでカーニング量を出力しないため、こちらが実際の描画幅になる）。
   */
  measureText(text: string, fontSize: number): number;
  /** pdf-lib へ渡すためのバイト列のコピー。 */
  cloneBytes(): Uint8Array;
}

/**
 * fontkit v2 の `create()` だけを取り出した最小の型。
 * `@types/fontkit` は Node の `Buffer` を要求するが、ブラウザ版は
 * Uint8Array を受け取るため、ここで一度だけ形を合わせる。
 */
interface FontkitModule {
  create(data: Uint8Array): FontkitFont;
}

let fontkitPromise: Promise<FontkitModule> | null = null;

/** fontkit v2 (ブラウザ向けビルド) を遅延読み込みする。 */
export async function loadFontkit(): Promise<FontkitModule> {
  fontkitPromise ??= import("fontkit").then(
    (mod) => mod as unknown as FontkitModule,
  );
  return fontkitPromise;
}

let loadedFontPromise: Promise<LoadedFont> | null = null;

export async function loadJapaneseFont(): Promise<LoadedFont> {
  loadedFontPromise ??= createLoadedFont().catch((error) => {
    // 失敗したら次回に再試行できるようにキャッシュを捨てる。
    loadedFontPromise = null;
    throw error;
  });
  return loadedFontPromise;
}

async function createLoadedFont(): Promise<LoadedFont> {
  let bytes: Uint8Array;
  try {
    const response = await fetch(FONT_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new PdfEditorError(
      "日本語フォントの読み込みに失敗しました。ページを再読み込みしてください。",
      { cause },
    );
  }

  let font: FontkitFont;
  try {
    const fontkit = await loadFontkit();
    font = fontkit.create(bytes);
  } catch (cause) {
    throw new PdfEditorError("日本語フォントの解析に失敗しました。", { cause });
  }

  const unitsPerEm = font.unitsPerEm || 1000;
  const metrics: FontMetrics = {
    unitsPerEm,
    ascentRatio: font.ascent / unitsPerEm,
    descentRatio: Math.abs(font.descent) / unitsPerEm,
  };

  // 1pt あたりの幅をキャッシュする。同じ文字列の再計測は描画のたびに
  // 発生するため、シェーピングを毎回走らせない。
  const widthCache = new Map<string, number>();
  const measureUnitWidth = (text: string): number => {
    const cached = widthCache.get(text);
    if (cached !== undefined) return cached;

    let total = 0;
    for (const glyph of font.layout(text).glyphs) {
      total += glyph.advanceWidth;
    }
    const unitWidth = total / unitsPerEm;

    if (widthCache.size > 5000) widthCache.clear();
    widthCache.set(text, unitWidth);
    return unitWidth;
  };

  return {
    metrics,
    measureText: (text, fontSize) =>
      text.length === 0 ? 0 : measureUnitWidth(text) * fontSize,
    cloneBytes: () => bytes.slice(),
  };
}

/**
 * pdf-lib の `registerFontkit` へ渡すための fontkit v2 アダプタ。
 *
 * pdf-lib 1.17 はサブセット生成に `subset.encodeStream()` (Node 風の
 * EventEmitter) を期待するが、fontkit v2 は同期的にバイト列を返す
 * `subset.encode()` しか持たない。その差分だけをここで吸収する。
 *
 * fontkit v2 を使う理由は同梱の `@pdf-lib/fontkit` (v1 系) のサブセット生成が
 * CJK フォントで壊れたグリフを出力するため。v2 は正しく出力でき、
 * 5MB のフォントが数十 KB まで縮む。
 */
export function createFontkitAdapter(fontkit: FontkitModule): unknown {
  return {
    create(data: Uint8Array) {
      const font = fontkit.create(data);
      const createSubset = font.createSubset.bind(font);

      font.createSubset = (): FontkitSubset => {
        const subset = createSubset();
        const withStream = subset as FontkitSubset & {
          encodeStream(): EncodeStreamShim;
        };

        withStream.encodeStream = () => {
          const handlers: Partial<Record<StreamEvent, StreamHandler>> = {};
          const emitter: EncodeStreamShim = {
            on(event, handler) {
              handlers[event] = handler;
              return emitter;
            },
          };

          // pdf-lib は data → end → error の順にハンドラを繋ぐので、
          // すべて登録され終わるまでマイクロタスクで待ってから発火する。
          void Promise.resolve().then(() => {
            try {
              handlers.data?.(new Uint8Array(subset.encode()));
              handlers.end?.(undefined);
            } catch (error) {
              handlers.error?.(error);
            }
          });

          return emitter;
        };

        return withStream;
      };

      return font;
    },
  };
}

/**
 * フォント取得が終わるまでの間だけ使う近似メトリクス。
 * 全角はほぼ 1em、半角はほぼ 0.5em として概算する。実測値に置き換わると
 * 位置が僅かに動くが、書き出しには必ず実フォントが使われる。
 */
export function createFallbackFont(): LoadedFont {
  const metrics: FontMetrics = {
    unitsPerEm: 1000,
    ascentRatio: 1.16,
    descentRatio: 0.288,
  };

  return {
    metrics,
    measureText: (text, fontSize) => {
      let units = 0;
      for (const char of text) {
        units += /[ -ÿ]/.test(char) ? 0.5 : 1;
      }
      return units * fontSize;
    },
    cloneBytes: () => {
      throw new PdfEditorError("日本語フォントがまだ読み込まれていません。");
    },
  };
}

type StreamEvent = "data" | "end" | "error";
type StreamHandler = (payload: unknown) => void;

interface EncodeStreamShim {
  on(event: StreamEvent, handler: StreamHandler): EncodeStreamShim;
}
