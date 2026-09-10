import { PDFDocument, degrees } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { PdfEditorError, translatePdfLibError } from "./errors";
import { createFontkitAdapter, loadFontkit, loadJapaneseFont } from "./font";
import { normalizeAngle } from "./coordinates";
import { buildElementOperators, normalizedToPdf } from "./drawElements";
import type { DrawResources, PageGeometry } from "./drawElements";
import { AnnotationResources, appendAnnotation } from "./annotations";
import { elementBoundingRect } from "./geometry";
import type { FontBook, LoadedFont } from "./font";
import { createFallbackFont } from "./font";
import type { ImageAssetStore } from "./imageAssets";
import type { EditorDoc, EditorElement, FontWeight } from "@/types/editor";

/** 読み込み済みの PDF ファイル 1 つ。 */
export interface PdfSource {
  id: string;
  bytes: Uint8Array;
  fileName: string;
}

/** 書き出し方。 */
export type ExportMode = "flatten" | "annotate";

/** ページを画像として取り込むための関数。 */
export type RasterizePage = (
  sourceId: string,
  sourceIndex: number,
  rotation: number,
) => Promise<{ bytes: Uint8Array; width: number; height: number }>;

export interface ExportOptions {
  sources: PdfSource[];
  doc: EditorDoc;
  images: ImageAssetStore;
  /** 出力ファイル名の元にする名前。 */
  baseFileName?: string;
  mode: ExportMode;
  /** 指定するとそのページだけを書き出す（ページ抽出・分割用）。 */
  pageIndexes?: number[];
  /**
   * pdf-lib が読めないファイル（パスワード保護など）を救済するための関数。
   * ページを画像として取り込み直す。
   */
  rasterizePage?: RasterizePage;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  /** サブセット埋め込みに失敗してフォント全体を埋め込んだ場合に true。 */
  usedFullFontEmbed: boolean;
  /** 画像として取り込み直したページがある場合に true（文字は選択できなくなる）。 */
  usedRasterFallback: boolean;
}

/**
 * 元 PDF に編集レイヤーを載せた新しい PDF を生成する。
 *
 * 座標変換は drawElements.ts / coordinates.ts を参照。要点は 3 つ。
 *   - 要素は正規化座標 (左上原点・Y下向き) で保持しているので、ページ回転を
 *     考慮して PDF ユーザー空間 (左下原点・Y上向き) へ変換する。
 *   - テキストの Y はブロック上端なので、ベースラインまで下げてから変換する。
 *   - 要素自身の回転は、正規化座標の段階で中心のまわりに回してから変換する。
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
  {
    sources,
    doc,
    images,
    baseFileName,
    mode,
    pageIndexes,
    rasterizePage,
  }: ExportOptions,
  { subset }: { subset: boolean },
): Promise<ExportResult> {
  if (sources.length === 0) {
    throw new PdfEditorError("書き出すPDFが読み込まれていません。");
  }

  // --- 対象ページを絞る（抽出・分割） ------------------------------
  const selected = pageIndexes ?? doc.pages.map((_, index) => index);
  const pageStates = selected.map((index) => doc.pages[index]);
  if (pageStates.some((page) => page === undefined)) {
    throw new PdfEditorError("指定されたページが見つかりませんでした。");
  }

  // --- 元ファイルを読み込む ----------------------------------------
  // パスワード保護された PDF は pdf-lib では開けない。その場合は
  // 表示に使っている pdf.js でページを画像へ起こし、そこへ編集を載せる。
  // 文字は選択できなくなるが、書き出せないよりは使える。
  const loadedSources = new Map<string, PDFDocument>();
  const rasterSources = new Set<string>();

  for (const source of sources) {
    try {
      loadedSources.set(source.id, await PDFDocument.load(source.bytes.slice()));
    } catch (error) {
      if (!rasterizePage) throw translatePdfLibError(error);
      rasterSources.add(source.id);
    }
  }

  // --- 出力する文書を組み立てる ------------------------------------
  // 1 ファイルのまま、順序も枚数も変わっていないなら、読み込んだ文書を
  // そのまま使う。しおり・文書情報・フォームなどページ以外の要素を
  // 保てるため。それ以外はページを複製して組み直す。
  const onlySource =
    sources.length === 1 && rasterSources.size === 0
      ? loadedSources.get(sources[0].id)
      : null;
  const isUnchanged =
    onlySource !== null &&
    onlySource !== undefined &&
    pageStates.length === onlySource.getPageCount() &&
    pageStates.every(
      (page, index) =>
        page.sourceIndex === index && page.sourceId === sources[0].id,
    );

  let pdfDoc: PDFDocument;
  let pages: PDFPage[];

  if (isUnchanged && onlySource) {
    pdfDoc = onlySource;
    pages = pdfDoc.getPages();
  } else {
    pdfDoc = await PDFDocument.create();

    for (const state of pageStates) {
      // 画像として取り込むファイルのページ。
      if (rasterSources.has(state.sourceId)) {
        const sourceInfo = sources.find((item) => item.id === state.sourceId);
        const baseRotation = 0;
        const raster = await (rasterizePage as RasterizePage)(
          state.sourceId,
          state.sourceIndex,
          baseRotation + state.rotation,
        );
        const image = await pdfDoc.embedPng(raster.bytes);
        const page = pdfDoc.addPage([raster.width, raster.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: raster.width,
          height: raster.height,
        });
        void sourceInfo;
        continue;
      }

      const source = loadedSources.get(state.sourceId);
      if (!source) {
        throw new PdfEditorError("ページの元ファイルが見つかりませんでした。");
      }
      if (state.sourceIndex >= source.getPageCount()) {
        throw new PdfEditorError(
          "ページ構成の解析に失敗したため書き出せませんでした。",
        );
      }
      const [copied] = await pdfDoc.copyPages(source, [state.sourceIndex]);
      pdfDoc.addPage(copied);
    }

    const first = loadedSources.get(sources[0].id);
    if (first) copyDocumentInfo(first, pdfDoc);
    pages = pdfDoc.getPages();
  }

  // --- 回転を確定させる --------------------------------------------
  // 元の /Rotate に、エディタ上で加えた回転を足したものが最終的な向き。
  // 要素の正規化座標は「最終的な向きで表示したページ」を基準にしている
  // ので、描画位置の計算にも同じ角度を使う。
  const finalRotations = pages.map((page, index) => {
    // 画像として取り込んだページは、回転を焼き込み済みなので触らない。
    if (rasterSources.has(pageStates[index].sourceId)) return 0;

    const rotation = normalizeAngle(
      page.getRotation().angle + pageStates[index].rotation,
    );
    page.setRotation(degrees(rotation));
    return rotation;
  });

  // --- 描く要素を集める --------------------------------------------
  // 選択したページだけを書き出す場合に備え、ページ番号を振り直す。
  const pageIndexMap = new Map(selected.map((original, next) => [original, next]));

  const drawable = doc.elements
    .filter(
      (element) =>
        pageIndexMap.has(element.pageIndex) &&
        (element.type !== "text" || element.text.length > 0),
    )
    .map((element) => ({
      element,
      pageIndex: pageIndexMap.get(element.pageIndex) as number,
    }));

  // --- フォントを用意する ------------------------------------------
  const usedWeights = new Set<FontWeight>();
  for (const { element } of drawable) {
    if (element.type === "text") usedWeights.add(element.fontWeight);
  }

  const measured = new Map<FontWeight, LoadedFont>();
  const embeddedFonts = new Map<FontWeight, PDFFont>();
  const usedFullFontEmbed = !subset && usedWeights.size > 0;

  if (usedWeights.size > 0) {
    const fontkit = subset
      ? createFontkitAdapter(await loadFontkit())
      : (await import("@pdf-lib/fontkit")).default;

    // pdf-lib の型は fontkit v1 の Fontkit を求めるが、実際に必要なのは
    // `create()` を持つオブジェクトだけ。アダプタもこれを満たす。
    pdfDoc.registerFontkit(
      fontkit as Parameters<typeof pdfDoc.registerFontkit>[0],
    );

    for (const weight of usedWeights) {
      const font = await loadJapaneseFont(weight);
      measured.set(weight, font);
      try {
        embeddedFonts.set(
          weight,
          await pdfDoc.embedFont(font.cloneBytes(), { subset }),
        );
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
  }

  const fallback = createFallbackFont();
  const fonts: FontBook = {
    get: (weight) => measured.get(weight) ?? fallback,
    loaded: () => [...measured.values()],
  };

  // 同じ画像を何度も埋め込まないようキャッシュする。
  const embeddedImages = new Map<string, PDFImage>();
  for (const { element } of drawable) {
    if (element.type !== "image" || embeddedImages.has(element.assetId)) continue;
    const asset = images.get(element.assetId);
    if (!asset) continue;
    embeddedImages.set(
      element.assetId,
      asset.format === "png"
        ? await pdfDoc.embedPng(asset.bytes.slice())
        : await pdfDoc.embedJpg(asset.bytes.slice()),
    );
  }

  // --- 描画 ---------------------------------------------------------
  for (const { element, pageIndex } of drawable) {
    const page = pages[pageIndex];
    const rotation = finalRotations[pageIndex];
    const cropBox = page.getCropBox();
    const swapped = rotation % 180 === 90;

    const geo: PageGeometry = {
      cropBox,
      rotation,
      view: {
        width: swapped ? cropBox.height : cropBox.width,
        height: swapped ? cropBox.width : cropBox.height,
      },
    };

    if (mode === "annotate") {
      drawAsAnnotation(pdfDoc, page, element, geo, fonts, embeddedFonts, embeddedImages);
    } else {
      drawIntoPage(page, element, geo, fonts, embeddedFonts, embeddedImages);
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
    fileName: buildFileName(baseFileName),
    usedFullFontEmbed,
    usedRasterFallback: rasterSources.size > 0,
  };
}

// ---------------------------------------------------------------------------
// 描画（ページ本体 / 注釈）
// ---------------------------------------------------------------------------

function drawIntoPage(
  page: PDFPage,
  element: EditorElement,
  geo: PageGeometry,
  fonts: FontBook,
  embeddedFonts: Map<FontWeight, PDFFont>,
  embeddedImages: Map<string, PDFImage>,
): void {
  const resources: DrawResources = {
    geo,
    fonts,
    graphicsState: (options) =>
      page.node.newExtGState(
        "GS",
        page.doc.context.obj({
          Type: "ExtGState",
          ca: options.opacity,
          CA: options.borderOpacity,
          BM: options.blendMode,
        }),
      ),
    font: (weight) => {
      const font = embeddedFonts.get(weight);
      if (!font) throw new PdfEditorError("フォントが用意できていません。");
      return { font, name: page.node.newFontDictionary("F", font.ref) };
    },
    image: (assetId) => {
      const image = embeddedImages.get(assetId);
      if (!image) return undefined;
      return {
        name: page.node.newXObject("Image", image.ref),
        width: image.width,
        height: image.height,
      };
    },
  };

  const operators = buildElementOperators(element, resources);
  if (operators.length > 0) page.pushOperators(...operators);
}

function drawAsAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  element: EditorElement,
  geo: PageGeometry,
  fonts: FontBook,
  embeddedFonts: Map<FontWeight, PDFFont>,
  embeddedImages: Map<string, PDFImage>,
): void {
  const annotationResources = new AnnotationResources(pdfDoc);

  const resources: DrawResources = {
    geo,
    fonts,
    graphicsState: (options) =>
      annotationResources.addExtGState({
        Type: "ExtGState",
        ca: options.opacity,
        CA: options.borderOpacity,
        BM: options.blendMode,
      }),
    font: (weight) => {
      const font = embeddedFonts.get(weight);
      if (!font) throw new PdfEditorError("フォントが用意できていません。");
      return { font, name: annotationResources.addFont(font.ref) };
    },
    image: (assetId) => {
      const image = embeddedImages.get(assetId);
      if (!image) return undefined;
      return {
        name: annotationResources.addXObject(image.ref),
        width: image.width,
        height: image.height,
      };
    },
  };

  const operators = buildElementOperators(element, resources);
  if (operators.length === 0) return;

  appendAnnotation(
    pdfDoc,
    page,
    element,
    geo,
    operators,
    annotationBox(element, geo, fonts),
    annotationResources,
  );
}

/** 注釈の矩形。線幅のはみ出しぶんだけ余裕を持たせる。 */
function annotationBox(
  element: EditorElement,
  geo: PageGeometry,
  fonts: FontBook,
) {
  const rect = elementBoundingRect(element, { view: geo.view, fonts });

  const strokeWidth =
    "strokeWidth" in element ? (element.strokeWidth as number) : 0;
  const padding = Math.max(strokeWidth * 2, 2);

  const corners = [
    normalizedToPdf(geo, rect.x, rect.y),
    normalizedToPdf(geo, rect.x + rect.w, rect.y),
    normalizedToPdf(geo, rect.x + rect.w, rect.y + rect.h),
    normalizedToPdf(geo, rect.x, rect.y + rect.h),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return {
    x0: Math.min(...xs) - padding,
    y0: Math.min(...ys) - padding,
    x1: Math.max(...xs) + padding,
    y1: Math.max(...ys) + padding,
  };
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
