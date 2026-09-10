import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfJs } from "./renderPdf";
import { normalizeRect } from "./geometry";
import type { NormalizedRect } from "@/types/editor";

/**
 * 元 PDF に入っている文字の位置を取り出す
 * ------------------------------------------------------------------
 * pdf.js の `getTextContent()` は文字の並びと変換行列を返す。これを
 * 正規化座標の矩形へ直しておくと、
 *   - 文字をなぞってハイライトする
 *   - 既存の文字を白で覆って書き換える
 *   - 文書内を検索する
 * のすべてに使える。
 *
 * 1 文字ずつの矩形は、行の送り幅を文字数で等分して求めている。日本語は
 * ほぼ等幅なので十分な精度が出る。欧文はやや粗いが、選択の用途では問題ない。
 */

export interface CharBox extends NormalizedRect {
  char: string;
  /** 同じ描画単位（行の断片）に属する文字をまとめる番号。 */
  runIndex: number;
}

export interface PageText {
  /** ページ全体の文字列（検索用）。 */
  text: string;
  chars: CharBox[];
  /** `text` の文字位置 → `chars` の添字。 */
  offsets: number[];
}

/** ベースラインから上をどれだけ文字の高さとみなすか。 */
const ASCENT_RATIO = 0.82;
const DESCENT_RATIO = 0.22;

/**
 * 1 ページ分の文字位置を取り出す。
 * `rotation` は表示に使っている最終的な回転角。
 */
export async function extractPageText(
  doc: PDFDocumentProxy,
  sourceIndex: number,
  rotation: number,
): Promise<PageText> {
  const pdfjs = await loadPdfJs();
  const page = await doc.getPage(sourceIndex + 1);
  const viewport = page.getViewport({ scale: 1, rotation });
  const content = await page.getTextContent();

  const chars: CharBox[] = [];
  const offsets: number[] = [];
  let text = "";
  let runIndex = 0;

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const value = item.str;
    if (value.length === 0) {
      if (item.hasEOL) text += "\n";
      continue;
    }

    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const width = item.width;

    // ベースラインの左端。pdf.js のテキストレイヤーと同じ考え方。
    const left = tx[4];
    const baseline = tx[5];
    const top = baseline - fontHeight * ASCENT_RATIO;
    const height = fontHeight * (ASCENT_RATIO + DESCENT_RATIO);

    const charWidth = width / value.length;

    for (let i = 0; i < value.length; i += 1) {
      offsets.push(chars.length);
      chars.push({
        char: value[i],
        runIndex,
        x: (left + charWidth * i) / viewport.width,
        y: top / viewport.height,
        w: charWidth / viewport.width,
        h: height / viewport.height,
      });
      text += value[i];
    }

    runIndex += 1;
    if (item.hasEOL) text += "\n";
  }

  return { text, chars, offsets };
}

/** 取り出した文字位置をページごとに覚えておく器。 */
export class TextLayerCache {
  private cache = new Map<string, Promise<PageText>>();

  constructor(private readonly doc: PDFDocumentProxy) {}

  get(sourceIndex: number, rotation: number): Promise<PageText> {
    const key = `${sourceIndex}:${rotation}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = extractPageText(this.doc, sourceIndex, rotation);
      this.cache.set(key, entry);
    }
    return entry;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * なぞった範囲にかかる文字を拾い、行ごとの矩形にまとめる。
 * ハイライトを 1 行ずつの帯にするために使う。
 */
export function selectLines(
  pageText: PageText,
  area: NormalizedRect,
): NormalizedRect[] {
  const hits = pageText.chars.filter(
    (box) =>
      box.x < area.x + area.w &&
      box.x + box.w > area.x &&
      box.y < area.y + area.h &&
      box.y + box.h > area.y,
  );
  if (hits.length === 0) return [];

  // 同じ描画単位ごとにまとめる。行をまたぐ選択でも自然な帯になる。
  const byRun = new Map<number, NormalizedRect>();
  for (const box of hits) {
    const existing = byRun.get(box.runIndex);
    byRun.set(
      box.runIndex,
      existing
        ? normalizeRect(
            Math.min(existing.x, box.x),
            Math.min(existing.y, box.y),
            Math.max(existing.x + existing.w, box.x + box.w),
            Math.max(existing.y + existing.h, box.y + box.h),
          )
        : { ...box },
    );
  }

  return [...byRun.values()];
}

/** なぞった範囲にかかる文字を、読める順につないだ文字列にする。 */
export function selectedText(
  pageText: PageText,
  area: NormalizedRect,
): string {
  const hits = pageText.chars.filter(
    (box) =>
      box.x < area.x + area.w &&
      box.x + box.w > area.x &&
      box.y < area.y + area.h &&
      box.y + box.h > area.y,
  );

  let result = "";
  let lastRun = -1;
  for (const box of hits) {
    if (lastRun !== -1 && box.runIndex !== lastRun) result += "";
    result += box.char;
    lastRun = box.runIndex;
  }
  return result;
}

export interface SearchMatch {
  pageIndex: number;
  rects: NormalizedRect[];
  /** 一致した文字列の前後を含む抜粋。 */
  excerpt: string;
}

/** ページ内の一致箇所を探す。大文字小文字は区別しない。 */
export function findInPage(
  pageText: PageText,
  query: string,
  pageIndex: number,
): SearchMatch[] {
  if (query.length === 0) return [];

  const haystack = pageText.text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: SearchMatch[] = [];

  let from = 0;
  for (;;) {
    const found = haystack.indexOf(needle, from);
    if (found === -1) break;
    from = found + Math.max(1, needle.length);

    // 一致した各文字の矩形を、描画単位ごとにまとめる。
    const boxes: NormalizedRect[] = [];
    const byRun = new Map<number, NormalizedRect>();
    for (let i = found; i < found + needle.length; i += 1) {
      const index = pageText.offsets[i];
      const box = index === undefined ? undefined : pageText.chars[index];
      if (!box) continue;
      const existing = byRun.get(box.runIndex);
      byRun.set(
        box.runIndex,
        existing
          ? normalizeRect(
              Math.min(existing.x, box.x),
              Math.min(existing.y, box.y),
              Math.max(existing.x + existing.w, box.x + box.w),
              Math.max(existing.y + existing.h, box.y + box.h),
            )
          : { x: box.x, y: box.y, w: box.w, h: box.h },
      );
    }
    boxes.push(...byRun.values());
    if (boxes.length === 0) continue;

    matches.push({
      pageIndex,
      rects: boxes,
      excerpt: pageText.text
        .slice(Math.max(0, found - 20), found + needle.length + 20)
        .replace(/\n/g, " "),
    });
  }

  return matches;
}
