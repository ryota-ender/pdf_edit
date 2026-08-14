import { PDFDocument, degrees, rgb } from "pdf-lib";
import { PdfEditorError, translatePdfLibError } from "./errors";
import { createFontkitAdapter, loadFontkit, loadJapaneseFont } from "./font";
import { hexToRgb01, normalizeAngle, viewPointToPdfPoint } from "./coordinates";
import { LINE_HEIGHT_FACTOR, layoutTextBlock } from "./textLayout";
import type { EditorDoc } from "@/types/editor";

export interface ExportOptions {
  /** 読み込み時の元 PDF のバイト列。書き換えないこと。 */
  originalBytes: Uint8Array;
  doc: EditorDoc;
  /** 元のファイル名。出力ファイル名の生成に使う。 */
  originalFileName?: string;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  /** サブセット埋め込みに失敗してフォント全体を埋め込んだ場合に true。 */
  usedFullFontEmbed: boolean;
}

/**
 * 元 PDF に編集レイヤーを焼き込んだ新しい PDF を生成する。
 *
 * 座標変換については `coordinates.ts` と `textLayout.ts` を参照。
 * 要点は次の 2 つ:
 *   - 要素は正規化座標 (左上原点) で保持されているので、ページ回転を
 *     考慮したうえで PDF ユーザー空間 (左下原点) へ変換する。
 *   - Y はテキストブロックの上端なので、ベースラインまで
 *     `ascentRatio × fontSize` 分だけ下げてから変換する。
 */
export async function exportPdf(options: ExportOptions): Promise<ExportResult> {
  // まずサブセット埋め込みを試す。CJK フォントは 5MB あるため、
  // サブセット化できるかどうかで出力サイズが 3MB / 数十 KB と大きく変わる。
  try {
    return await buildPdf(options, { subset: true });
  } catch (error) {
    if (error instanceof PdfEditorError) throw error;

    // サブセット生成でしくじった場合だけ、フォント全体を埋め込んで
    // もう一度作り直す。出力は重くなるが文字化けはしない。
    console.warn(
      "[pdf-edit] フォントのサブセット埋め込みに失敗したため、フォント全体を埋め込みます",
      error,
    );
    return buildPdf(options, { subset: false });
  }
}

async function buildPdf(
  { originalBytes, doc, originalFileName }: ExportOptions,
  { subset }: { subset: boolean },
): Promise<ExportResult> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(originalBytes.slice());
  } catch (error) {
    throw translatePdfLibError(error);
  }

  // --- ページ削除 -------------------------------------------------
  // 先に全ページの参照を取っておく。pdf-lib の removePage は内部の
  // ページキャッシュを破棄しないため、削除後に getPages() を呼ぶと
  // 消したはずのページを含む古い配列が返ってくる。
  const allPages = pdfDoc.getPages();

  const pages = doc.pages.map((page) => allPages[page.sourceIndex]);
  if (pages.some((page) => page === undefined)) {
    throw new PdfEditorError(
      "ページ構成の解析に失敗したため書き出せませんでした。",
    );
  }

  // 残すページ以外をページツリーから外す。ここで取得済みの PDFPage は
  // そのまま有効なので、描画対象としては引き続き使える。
  const survivingSourceIndexes = new Set(doc.pages.map((p) => p.sourceIndex));
  for (let index = allPages.length - 1; index >= 0; index -= 1) {
    if (!survivingSourceIndexes.has(index)) {
      pdfDoc.removePage(index);
    }
  }

  // --- 回転を確定させる -------------------------------------------
  // 元の /Rotate に、エディタ上で加えた回転を足したものが最終的な向き。
  // 要素の正規化座標は「最終的な向きで表示したページ」を基準にしている
  // ので、描画位置の計算にもこの角度を使う。
  const finalRotations = pages.map((page, index) => {
    const original = page.getRotation().angle;
    const rotation = normalizeAngle(original + doc.pages[index].rotation);
    page.setRotation(degrees(rotation));
    return rotation;
  });

  // --- テキストの焼き込み -----------------------------------------
  const drawable = doc.elements.filter(
    (element) => element.text.length > 0 && element.pageIndex < pages.length,
  );

  const usedFullFontEmbed = !subset && drawable.length > 0;

  if (drawable.length > 0) {
    const font = await loadJapaneseFont();
    const fontkit = subset
      ? createFontkitAdapter(await loadFontkit())
      : (await import("@pdf-lib/fontkit")).default;

    // pdf-lib の型は fontkit v1 の Fontkit を要求するが、必要なのは
    // `create()` を持つオブジェクトだけ。アダプタもこれを満たす。
    pdfDoc.registerFontkit(fontkit as Parameters<typeof pdfDoc.registerFontkit>[0]);

    let embeddedFont;
    try {
      embeddedFont = await pdfDoc.embedFont(font.cloneBytes(), { subset });
    } catch (error) {
      if (!subset) {
        throw new PdfEditorError(
          "日本語フォントの埋め込みに失敗したため書き出せませんでした。",
          { cause: error },
        );
      }
      throw error; // 呼び出し元がフォント全体埋め込みで再試行する。
    }

    for (const element of drawable) {
      const page = pages[element.pageIndex];
      const rotation = finalRotations[element.pageIndex];
      const cropBox = page.getCropBox();

      // 回転を適用した「表示中のページ」の寸法。正規化座標の基準。
      const swapped = rotation % 180 === 90;
      const viewWidth = swapped ? cropBox.height : cropBox.width;
      const viewHeight = swapped ? cropBox.width : cropBox.height;

      const layout = layoutTextBlock(element.text, element.fontSize, font);

      // ビュー座標での 1 行目のベースライン始点。
      const baselineViewX = element.x * viewWidth;
      const baselineViewY = element.y * viewHeight + layout.baselineOffsets[0];

      const origin = viewPointToPdfPoint(
        baselineViewX,
        baselineViewY,
        cropBox,
        rotation,
      );

      const { r, g, b } = hexToRgb01(element.color);

      page.drawText(element.text, {
        x: origin.x,
        y: origin.y,
        size: element.fontSize,
        font: embeddedFont,
        color: rgb(r, g, b),
        // pdf-lib は改行ごとにテキスト空間で lineHeight だけ下へ送る。
        // プレビューの行送りと同じ値を渡すので 2 行目以降も一致する。
        lineHeight: LINE_HEIGHT_FACTOR * element.fontSize,
        // ページが回転していても文字が正しい向きに載るようにする。
        // pdf-lib の rotate は反時計回り、ページの /Rotate は時計回りで、
        // ちょうど打ち消し合う関係になる。
        rotate: degrees(rotation),
      });
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await pdfDoc.save();
  } catch (error) {
    throw translatePdfLibError(error);
  }

  // Blob へは ArrayBuffer を渡す。pdf-lib が返す Uint8Array は
  // SharedArrayBuffer 由来の可能性を型上排除できないため、実体をコピーする。
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return {
    blob: new Blob([buffer], { type: "application/pdf" }),
    fileName: buildFileName(originalFileName),
    usedFullFontEmbed,
  };
}

/** `report.pdf` → `report-edited.pdf`。名前が無ければ既定名を使う。 */
export function buildFileName(originalFileName?: string): string {
  if (!originalFileName) return "edited-document.pdf";
  const base = originalFileName.replace(/\.pdf$/i, "").trim();
  return base.length > 0 ? `${base}-edited.pdf` : "edited-document.pdf";
}

/** 生成した Blob をダウンロードさせ、URL を確実に解放する。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // click() は同期的にダウンロードを開始するが、すぐ revoke すると
    // 一部ブラウザで取りこぼすため 1 フレーム待ってから解放する。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
