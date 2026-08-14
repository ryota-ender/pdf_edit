import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import { PdfEditorError, translatePdfJsError } from "./errors";
import type { PageSize } from "@/types/editor";

/**
 * pdf.js の初期化と描画。
 *
 * worker と CMap / 標準フォントは `public/pdfjs/` から素の URL で配信する
 * (`scripts/copy-pdfjs-assets.mjs` が配置)。バンドラのワーカー解決に依存
 * しないので、Turbopack でも webpack でも `next start` でも同じ挙動になる。
 * CMap は日本語 PDF の文字コード変換に必要。
 */

const PDFJS_ASSET_BASE = "/pdfjs/";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

export async function loadPdfJs(): Promise<PdfJsModule> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_BASE}pdf.worker.min.mjs`;
    return pdfjs;
  })().catch((error) => {
    pdfjsPromise = null;
    throw error;
  });

  return pdfjsPromise;
}

/**
 * PDF を読み込む。
 *
 * pdf.js は渡された ArrayBuffer をワーカーへ transfer して切り離すため、
 * 呼び出し側が保持している元データを壊さないよう **必ずコピーを渡す**。
 * 書き出し時に pdf-lib が同じバイト列を必要とするので、これは重要。
 */
export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** ワーカーごと破棄する。PDFDocumentProxy 側からは呼べないので分けて返す。 */
  destroy: () => Promise<void>;
}

export async function loadPdfDocument(bytes: Uint8Array): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs().catch((error) => {
    throw new PdfEditorError(
      "PDF表示エンジン (PDF.js) の読み込みに失敗しました。ページを再読み込みしてください。",
      { cause: error },
    );
  });

  const task = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  });

  try {
    const doc = await task.promise;
    return {
      doc,
      destroy: () => task.destroy().catch(() => undefined),
    };
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw translatePdfJsError(error);
  }
}

/** ページの回転を **適用していない** 素の寸法 (ポイント) を返す。 */
export async function getPageSizes(
  doc: PDFDocumentProxy,
): Promise<{ sizes: PageSize[]; rotations: number[] }> {
  const sizes: PageSize[] = [];
  const rotations: number[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    sizes.push({ width: viewport.width, height: viewport.height });
    rotations.push(page.rotate);
  }

  return { sizes, rotations };
}

export interface RenderPageOptions {
  canvas: HTMLCanvasElement;
  /** 元 PDF における 0 始まりのページ番号。 */
  sourceIndex: number;
  /** 描画倍率。CSS ピクセル数 = ポイント数 × scale になる。 */
  scale: number;
  /** ページに適用する最終的な回転角 (元の回転 + エディタでの回転)。 */
  rotation: number;
  /** キャンバスのバッキングストア倍率。通常は devicePixelRatio。 */
  pixelRatio?: number;
}

/**
 * 1 ページを canvas へ描画する。
 * 返される関数を呼ぶと描画を中断できる（ページ切り替え・アンマウント時に使う）。
 */
export function renderPageToCanvas(
  doc: PDFDocumentProxy,
  options: RenderPageOptions,
): { done: Promise<void>; cancel: () => void } {
  const { canvas, sourceIndex, scale, rotation, pixelRatio = 1 } = options;

  let cancelled = false;
  let task: RenderTask | null = null;
  let page: PDFPageProxy | null = null;

  const done = (async () => {
    page = await doc.getPage(sourceIndex + 1);
    if (cancelled) return;

    const viewport = page.getViewport({
      scale: scale * pixelRatio,
      // pdf.js の rotation はページ本来の回転を含んだ絶対角として扱われる。
      rotation,
    });

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new PdfEditorError("Canvasの初期化に失敗しました。");
    }

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${viewport.width / pixelRatio}px`;
    canvas.style.height = `${viewport.height / pixelRatio}px`;

    task = page.render({ canvas, viewport, background: "#ffffff" });
    await task.promise;
  })().catch((error) => {
    // 中断は正常系なので握りつぶす。
    if (cancelled) return;
    if (error instanceof Error && error.name === "RenderingCancelledException") {
      return;
    }
    throw error;
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}
