import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
} from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { PdfEditorError, translatePdfLibError } from "./errors";
import { createFontkitAdapter, loadFontkit, loadJapaneseFont } from "./font";
import { hexToRgb01, normalizeAngle, viewPointToPdfPoint } from "./coordinates";
import { LINE_HEIGHT_FACTOR, layoutTextBlock } from "./textLayout";
import type { LoadedFont } from "./font";
import type { ImageAssetStore } from "./imageAssets";
import type {
  EditorDoc,
  EditorElement,
  PenElement,
} from "@/types/editor";

export interface ExportOptions {
  /** 読み込み時の元 PDF のバイト列。書き換えないこと。 */
  originalBytes: Uint8Array;
  doc: EditorDoc;
  images: ImageAssetStore;
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
 * 座標変換の考え方は coordinates.ts / textLayout.ts を参照。要点は 2 つ。
 *   - 要素は正規化座標 (左上原点・Y下向き) で保持しているので、ページ回転を
 *     考慮して PDF ユーザー空間 (左下原点・Y上向き) へ変換する。
 *   - テキストの Y はブロック上端なので、ベースラインまで
 *     `ascentRatio × fontSize` 下げてから変換する。
 */
export async function exportPdf(options: ExportOptions): Promise<ExportResult> {
  // まずサブセット埋め込みを試す。日本語フォントは 5MB あるため、
  // サブセット化できるかで出力サイズが 3MB / 数十KB と大きく変わる。
  try {
    return await buildPdf(options, { subset: true });
  } catch (error) {
    if (error instanceof PdfEditorError) throw error;

    console.warn(
      "[pdf-edit] フォントのサブセット埋め込みに失敗したため、フォント全体を埋め込みます",
      error,
    );
    return buildPdf(options, { subset: false });
  }
}

async function buildPdf(
  { originalBytes, doc, images, originalFileName }: ExportOptions,
  { subset }: { subset: boolean },
): Promise<ExportResult> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(originalBytes.slice());
  } catch (error) {
    throw translatePdfLibError(error);
  }

  // --- ページ構成を組み立てる -------------------------------------
  const sourceCount = pdfDoc.getPageCount();
  if (doc.pages.some((page) => page.sourceIndex >= sourceCount)) {
    throw new PdfEditorError(
      "ページ構成の解析に失敗したため書き出せませんでした。",
    );
  }

  // 並び順も枚数も元のままなら、読み込んだ文書をそのまま使う。
  // しおり・文書情報・フォームなど、ページ以外の要素を保てるため。
  const isUnchanged =
    doc.pages.length === sourceCount &&
    doc.pages.every((page, index) => page.sourceIndex === index);

  let pages: PDFPage[];

  if (isUnchanged) {
    pages = pdfDoc.getPages();
  } else {
    // 削除・並べ替え・複製が入っている場合は、必要なページだけを
    // 新しい文書へ順番に複製する。同じページ番号を 2 回指定すれば
    // そのまま複製になる。
    const rebuilt = await PDFDocument.create();
    const copied = await rebuilt.copyPages(
      pdfDoc,
      doc.pages.map((page) => page.sourceIndex),
    );
    for (const page of copied) rebuilt.addPage(page);

    copyDocumentInfo(pdfDoc, rebuilt);
    pdfDoc = rebuilt;
    pages = pdfDoc.getPages();
  }

  // --- 回転を確定させる -------------------------------------------
  // 元の /Rotate に、エディタ上で加えた回転を足したものが最終的な向き。
  // 要素の正規化座標は「最終的な向きで表示したページ」を基準にしている
  // ので、描画位置の計算にも同じ角度を使う。
  const finalRotations = pages.map((page, index) => {
    const rotation = normalizeAngle(
      page.getRotation().angle + doc.pages[index].rotation,
    );
    page.setRotation(degrees(rotation));
    return rotation;
  });

  // --- 描く要素を集める -------------------------------------------
  const drawable = doc.elements.filter(
    (element) =>
      element.pageIndex < pages.length &&
      (element.type !== "text" || element.text.length > 0),
  );

  const needsFont = drawable.some((element) => element.type === "text");
  const usedFullFontEmbed = !subset && needsFont;

  let font: LoadedFont | null = null;
  let embeddedFont: PDFFont | null = null;

  if (needsFont) {
    font = await loadJapaneseFont();
    const fontkit = subset
      ? createFontkitAdapter(await loadFontkit())
      : (await import("@pdf-lib/fontkit")).default;

    // pdf-lib の型は fontkit v1 の Fontkit を求めるが、実際に必要なのは
    // `create()` を持つオブジェクトだけ。アダプタもこれを満たす。
    pdfDoc.registerFontkit(
      fontkit as Parameters<typeof pdfDoc.registerFontkit>[0],
    );

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
  }

  // 同じ画像を何度も埋め込まないようキャッシュする。
  const embeddedImages = new Map<string, PDFImage>();

  for (const element of drawable) {
    const page = pages[element.pageIndex];
    const rotation = finalRotations[element.pageIndex];
    const cropBox = page.getCropBox();

    // 回転を適用した「表示中のページ」の寸法。正規化座標の基準。
    const swapped = rotation % 180 === 90;
    const view = {
      width: swapped ? cropBox.height : cropBox.width,
      height: swapped ? cropBox.width : cropBox.height,
    };

    /** 正規化座標 → PDF ユーザー空間。 */
    const toPdf = (nx: number, ny: number) =>
      viewPointToPdfPoint(nx * view.width, ny * view.height, cropBox, rotation);

    switch (element.type) {
      case "text":
        if (embeddedFont && font) {
          drawTextElement(page, element, view, cropBox, rotation, font, embeddedFont);
        }
        break;

      case "highlight": {
        const box = toPdfRect(element, view, cropBox, rotation);
        const { r, g, b } = hexToRgb01(element.color);
        page.drawRectangle({
          ...box,
          color: rgb(r, g, b),
          opacity: element.opacity,
          // 乗算合成にすると、下にある文字が透けて本物の蛍光ペンに見える。
          blendMode: BlendMode.Multiply,
        });
        break;
      }

      case "rect": {
        const box = toPdfRect(element, view, cropBox, rotation);
        const fill = element.fill ? hexToRgb01(element.fill) : null;
        const stroke = element.stroke ? hexToRgb01(element.stroke) : null;
        page.drawRectangle({
          ...box,
          color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
          opacity: fill ? element.opacity : undefined,
          borderColor: stroke ? rgb(stroke.r, stroke.g, stroke.b) : undefined,
          borderWidth: stroke ? element.strokeWidth : 0,
          borderOpacity: stroke ? element.opacity : undefined,
        });
        break;
      }

      case "ellipse": {
        const box = toPdfRect(element, view, cropBox, rotation);
        const fill = element.fill ? hexToRgb01(element.fill) : null;
        const stroke = element.stroke ? hexToRgb01(element.stroke) : null;
        page.drawEllipse({
          // pdf-lib の楕円は中心指定。
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          xScale: box.width / 2,
          yScale: box.height / 2,
          color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
          opacity: fill ? element.opacity : undefined,
          borderColor: stroke ? rgb(stroke.r, stroke.g, stroke.b) : undefined,
          borderWidth: stroke ? element.strokeWidth : 0,
          borderOpacity: stroke ? element.opacity : undefined,
        });
        break;
      }

      case "arrow": {
        const start = toPdf(element.x1, element.y1);
        const end = toPdf(element.x2, element.y2);
        const { r, g, b } = hexToRgb01(element.color);
        const color = rgb(r, g, b);

        page.drawLine({
          start,
          end,
          thickness: element.strokeWidth,
          color,
          opacity: element.opacity,
          lineCap: LineCapStyle.Round,
        });

        if (element.head) {
          page.drawSvgPath(arrowHeadPath(start, end, element.strokeWidth), {
            x: 0,
            y: 0,
            scale: 1,
            color,
            opacity: element.opacity,
          });
        }
        break;
      }

      case "pen": {
        const path = penPath(element, toPdf);
        if (!path) break;
        const { r, g, b } = hexToRgb01(element.color);

        // drawSvgPath は線の結合方法を指定できず、既定のマイター結合だと
        // 折れ角の外側に鋭い突起が出てしまう。プレビュー (SVG の
        // stroke-linejoin="round") と揃えるため、外側で丸い結合を指定する。
        page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
        page.drawSvgPath(path, {
          x: 0,
          y: 0,
          scale: 1,
          borderColor: rgb(r, g, b),
          borderWidth: element.strokeWidth,
          borderOpacity: element.opacity,
          borderLineCap: LineCapStyle.Round,
        });
        page.pushOperators(popGraphicsState());
        break;
      }

      case "image": {
        const asset = images.get(element.assetId);
        if (!asset) break;

        let image = embeddedImages.get(element.assetId);
        if (!image) {
          image =
            asset.format === "png"
              ? await pdfDoc.embedPng(asset.bytes.slice())
              : await pdfDoc.embedJpg(asset.bytes.slice());
          embeddedImages.set(element.assetId, image);
        }

        const box = toPdfRect(element, view, cropBox, rotation);
        page.drawImage(image, {
          ...box,
          opacity: element.opacity,
          // ページが回転していても画像が正しい向きで載るようにする。
          rotate: degrees(rotation),
          ...imageRotationOffset(box, rotation),
        });
        break;
      }
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

// ---------------------------------------------------------------------------
// 個別の描画
// ---------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

function drawTextElement(
  page: PDFPage,
  element: Extract<EditorElement, { type: "text" }>,
  view: { width: number; height: number },
  cropBox: Box,
  rotation: number,
  font: LoadedFont,
  embeddedFont: PDFFont,
): void {
  const layout = layoutTextBlock(element.text, element.fontSize, font);
  const { r, g, b } = hexToRgb01(element.color);

  // 行揃えは行ごとに開始位置をずらして表現する。pdf-lib には
  // 行揃えの概念がないため、こちらで各行の左端を決める。
  layout.lines.forEach((line, index) => {
    if (line.length === 0) return;

    const lineWidth = font.measureText(line, element.fontSize);
    const offset =
      element.align === "center"
        ? (layout.width - lineWidth) / 2
        : element.align === "right"
          ? layout.width - lineWidth
          : 0;

    const baselineViewX = element.x * view.width + offset;
    const baselineViewY =
      element.y * view.height + layout.baselineOffsets[index];

    const origin = viewPointToPdfPoint(
      baselineViewX,
      baselineViewY,
      cropBox,
      rotation,
    );

    page.drawText(line, {
      x: origin.x,
      y: origin.y,
      size: element.fontSize,
      font: embeddedFont,
      color: rgb(r, g, b),
      opacity: element.opacity,
      lineHeight: LINE_HEIGHT_FACTOR * element.fontSize,
      // pdf-lib の rotate は反時計回り、ページの /Rotate は時計回りで、
      // ちょうど打ち消し合う関係になる。
      rotate: degrees(rotation),
    });
  });
}

/**
 * 正規化矩形を PDF ユーザー空間の軸平行な矩形へ変換する。
 * ページ回転は 90 度単位なので、4 隅を変換して外接矩形を取れば足りる。
 */
function toPdfRect(
  element: { x: number; y: number; w: number; h: number },
  view: { width: number; height: number },
  cropBox: Box,
  rotation: number,
): Box {
  const corners = [
    [element.x, element.y],
    [element.x + element.w, element.y],
    [element.x + element.w, element.y + element.h],
    [element.x, element.y + element.h],
  ].map(([nx, ny]) =>
    viewPointToPdfPoint(nx * view.width, ny * view.height, cropBox, rotation),
  );

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

/**
 * `drawImage` の rotate は左下を軸に反時計回りで回すため、回転後の位置が
 * ずれる。回した結果が元の矩形に重なるよう、描画原点を補正する。
 */
function imageRotationOffset(box: Box, rotation: number): Partial<Box> {
  switch (normalizeAngle(rotation)) {
    case 90:
      return { x: box.x + box.width, width: box.height, height: box.width };
    case 180:
      return { x: box.x + box.width, y: box.y + box.height };
    case 270:
      return { y: box.y + box.height, width: box.height, height: box.width };
    default:
      return {};
  }
}

/**
 * SVG パス文字列を組み立てる。
 *
 * pdf-lib の `drawSvgPath` は translate(x,y) → rotate → scale(1,-1) を適用する。
 * つまり x=0, y=0, scale=1 で呼べば、パス上の点 (px, py) は PDF 座標
 * (px, -py) に落ちる。よって「PDF 座標に変換済みの点の Y を反転して」
 * 書き出せば、回転を含めて自前の変換結果をそのまま使える。
 */
function penPath(
  element: PenElement,
  toPdf: (nx: number, ny: number) => { x: number; y: number },
): string | null {
  if (element.points.length < 2) return null;

  return element.points
    .map((point, index) => {
      const pdfPoint = toPdf(point.x, point.y);
      const command = index === 0 ? "M" : "L";
      return `${command} ${pdfPoint.x.toFixed(2)} ${(-pdfPoint.y).toFixed(2)}`;
    })
    .join(" ");
}

function arrowHeadPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  strokeWidth: number,
): string {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.max(6, strokeWidth * 3.5);
  const halfWidth = Math.max(3, strokeWidth * 2);

  const left = {
    x: end.x - length * Math.cos(angle) + halfWidth * Math.sin(angle),
    y: end.y - length * Math.sin(angle) - halfWidth * Math.cos(angle),
  };
  const right = {
    x: end.x - length * Math.cos(angle) - halfWidth * Math.sin(angle),
    y: end.y - length * Math.sin(angle) + halfWidth * Math.cos(angle),
  };

  // penPath と同じ理由で Y を反転する。
  return `M ${end.x} ${-end.y} L ${left.x} ${-left.y} L ${right.x} ${-right.y} Z`;
}

/**
 * ページを組み直したときに失われる文書情報を引き継ぐ。
 * しおりやフォームまでは移せないが、タイトル等は保てる。
 */
function copyDocumentInfo(from: PDFDocument, to: PDFDocument): void {
  try {
    to.setTitle(from.getTitle() ?? "");
    to.setAuthor(from.getAuthor() ?? "");
    to.setSubject(from.getSubject() ?? "");
    to.setKeywords(from.getKeywords()?.split(/\s+/).filter(Boolean) ?? []);
    to.setCreator(from.getCreator() ?? "");
  } catch {
    // 文書情報が壊れている PDF もあるので、失敗しても書き出しは続ける。
  }
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
    // 一部ブラウザで取りこぼすため少し待ってから解放する。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
