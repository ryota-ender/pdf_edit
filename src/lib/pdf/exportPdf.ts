import { PDFDocument, degrees } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { PdfEditorError, translatePdfLibError } from "./errors";
import { createFontkitAdapter, loadFontkit, loadJapaneseFont } from "./font";
import { normalizeAngle, viewPointToPdfPoint } from "./coordinates";
import { buildElementOperators, normalizedToPdf } from "./drawElements";
import type { DrawResources, PageGeometry } from "./drawElements";
import { AnnotationResources, appendAnnotation } from "./annotations";
import { copyOutlines } from "./outlines";
import { applyFormValues } from "./forms";
import { elementBoundingRect } from "./geometry";
import type { FontBook, LoadedFont } from "./font";
import { createFallbackFont } from "./font";
/** 書き出しに必要な画像データ（Worker へ渡せるよう素の値だけ）。 */
export interface ExportImage {
  id: string;
  bytes: Uint8Array;
  format: "png" | "jpg";
}
import type {
  EditorDoc,
  EditorElement,
  FontWeight,
  PageState,
} from "@/types/editor";
import { hasText, isBlankPage } from "@/types/editor";

/** 読み込み済みの PDF ファイル 1 つ。 */
export interface PdfSource {
  id: string;
  bytes: Uint8Array;
  fileName: string;
}

/** 書き出し方。 */
export type ExportMode = "flatten" | "annotate";

/** 画像として取り込み直したページ。キーは `${sourceId}:${sourceIndex}`。 */
export interface RasterPage {
  key: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface ExportOptions {
  sources: PdfSource[];
  doc: EditorDoc;
  images: ExportImage[];
  /** 出力ファイル名の元にする名前。 */
  baseFileName?: string;
  mode: ExportMode;
  /** 指定するとそのページだけを書き出す（ページ抽出・分割用）。 */
  pageIndexes?: number[];
  /**
   * pdf-lib が読めないファイル（パスワード保護など）の救済用に、
   * 呼び出し側で画像化しておいたページ。
   */
  rasters?: RasterPage[];
  /** フォーム欄へ書き込む値。 */
  formValues?: Record<string, string>;
  /** フォームを編集できない状態に固める。 */
  flattenForm?: boolean;
}

export interface ExportResult {
  bytes: Uint8Array;
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
    rasters,
    formValues,
    flattenForm,
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
      // 画像化しておいたページがあるなら、そちらで組み立てる。
      const hasRaster = rasters?.some((raster) =>
        raster.key.startsWith(`${source.id}:`),
      );
      if (!hasRaster) throw translatePdfLibError(error);
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
      // 白紙ページ。元ページを持たないので、指定の寸法で作るだけ。
      if (isBlankPage(state)) {
        const size = state.blankSize ?? { width: 595.28, height: 841.89 };
        pdfDoc.addPage([size.width, size.height]);
        continue;
      }

      // 画像として取り込むファイルのページ。
      if (rasterSources.has(state.sourceId)) {
        const raster = rasters?.find(
          (item) => item.key === `${state.sourceId}:${state.sourceIndex}`,
        );
        if (!raster) {
          throw new PdfEditorError(
            "保護されたPDFのページを取り込めませんでした。",
          );
        }
        const image = await pdfDoc.embedPng(raster.bytes.slice());
        const page = pdfDoc.addPage([raster.width, raster.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: raster.width,
          height: raster.height,
        });
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
    if (first) {
      copyDocumentInfo(first, pdfDoc);
      // 並びが変わっていない範囲でしおりを引き継ぐ。
      copyOutlines(first, pdfDoc, pageStates, sources[0].id);
    }
    pages = pdfDoc.getPages();
  }

  // --- 回転を確定させる --------------------------------------------
  // 元の /Rotate に、エディタ上で加えた回転を足したものが最終的な向き。
  // 要素の正規化座標は「最終的な向きで表示したページ」を基準にしている
  // ので、描画位置の計算にも同じ角度を使う。
  const finalRotations = pages.map((page, index) => {
    const state = pageStates[index];

    // 画像として取り込んだページと白紙は、回転を焼き込み済みなので触らない。
    if (rasterSources.has(state.sourceId) || isBlankPage(state)) {
      applyCrop(page, state, 0);
      return 0;
    }

    const rotation = normalizeAngle(
      page.getRotation().angle + state.rotation,
    );
    page.setRotation(degrees(rotation));
    applyCrop(page, state, rotation);
    return rotation;
  });

  // 用紙サイズの変更は、元ページを縮小して新しい用紙の中央へ置き直す。
  if (pageStates.some((state) => state.resizeTo)) {
    await resizePages(pdfDoc, pages, pageStates);
    pages = pdfDoc.getPages();
  }

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
  // 文字を持つ要素（テキストと吹き出し）で使うウェイトを集める。
  const usedWeights = new Set<FontWeight>();
  for (const { element } of drawable) {
    if (hasText(element)) usedWeights.add(element.fontWeight);
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
    const asset = images.find((image) => image.id === element.assetId);
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

  // フォーム欄への記入。注釈より先に済ませて外観を確定させる。
  if (formValues && Object.keys(formValues).length > 0) {
    await applyFormValues(pdfDoc, formValues, {
      flatten: flattenForm ?? false,
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = await pdfDoc.save();
  } catch (error) {
    throw translatePdfLibError(error);
  }

  return {
    bytes,
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
 * 切り抜きを CropBox として適用する。
 *
 * 要素の正規化座標は「表示中のページ」を基準にしているので、CropBox を
 * 縮めればそのまま新しい版面が基準になる。描画側は `getCropBox()` を
 * 見ているため、追加の変換は要らない。
 */
function applyCrop(page: PDFPage, state: PageState, rotation: number): void {
  if (!state.crop) return;

  const box = page.getCropBox();
  const swapped = rotation % 180 === 90;
  const viewWidth = swapped ? box.height : box.width;
  const viewHeight = swapped ? box.width : box.height;

  // 表示座標の切り抜き矩形を、ページのユーザー空間へ戻す。
  const corners = [
    viewPointToPdfPoint(
      state.crop.x * viewWidth,
      state.crop.y * viewHeight,
      box,
      rotation,
    ),
    viewPointToPdfPoint(
      (state.crop.x + state.crop.w) * viewWidth,
      (state.crop.y + state.crop.h) * viewHeight,
      box,
      rotation,
    ),
  ];

  const x0 = Math.min(corners[0].x, corners[1].x);
  const y0 = Math.min(corners[0].y, corners[1].y);
  const x1 = Math.max(corners[0].x, corners[1].x);
  const y1 = Math.max(corners[0].y, corners[1].y);

  page.setCropBox(x0, y0, x1 - x0, y1 - y0);
}

/**
 * 用紙サイズを変える。
 * 元のページを部品として埋め込み、縦横比を保ったまま中央へ置く。
 */
async function resizePages(
  pdfDoc: PDFDocument,
  pages: PDFPage[],
  states: PageState[],
): Promise<void> {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const target = states[index].resizeTo;
    if (!target) continue;

    const embedded = await pdfDoc.embedPage(pages[index]);
    const scale = Math.min(
      target.width / embedded.width,
      target.height / embedded.height,
    );

    const page = pdfDoc.insertPage(index, [target.width, target.height]);
    page.drawPage(embedded, {
      xScale: scale,
      yScale: scale,
      x: (target.width - embedded.width * scale) / 2,
      y: (target.height - embedded.height * scale) / 2,
    });
    // 元のページ（1 つ後ろへずれている）を取り除く。
    pdfDoc.removePage(index + 1);
  }
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

/**
 * 生成した PDF をそのまま印刷ダイアログへ送る。
 * ダウンロードを挟まずに刷れるので、確認印刷が速い。
 */
export function printBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = url;

  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // 印刷できない環境では黙って諦める（ダウンロードは使える）。
    }
    // 印刷ダイアログが閉じるまで iframe を残す必要があるため、
    // 少し余裕を持ってから片付ける。
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  };

  document.body.appendChild(frame);
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
