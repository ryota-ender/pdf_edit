import { assetUrl } from "@/lib/basePath";
import { PdfEditorError } from "./errors";
import type { CharBox, PageText } from "./textLayer";

/**
 * スキャンPDFの文字起こし（OCR）
 * ------------------------------------------------------------------
 * 文字情報を持たないPDFでは、ハイライトの行吸着・検索・既存テキストの
 * 書き換えがどれも空振りする。そこでページを画像として認識し直し、
 * `textLayer.ts` と同じ形の「文字位置つきテキスト」を作る。
 * こうすると既存の機能がそのまま動く。
 *
 * Tesseract の実行ファイルと学習データは自分のドメインから配る
 * (`public/ocr/`)。画像も認識結果も外部へ送らない。
 */

const OCR_BASE = assetUrl("/ocr/");

export type OcrLanguage = "jpn" | "eng" | "jpn+eng";

export interface OcrProgress {
  /** 0〜1。 */
  ratio: number;
  label: string;
}

type TesseractModule = typeof import("tesseract.js");

let modulePromise: Promise<TesseractModule> | null = null;

async function loadTesseract(): Promise<TesseractModule> {
  modulePromise ??= import("tesseract.js");
  return modulePromise;
}

interface WorkerHandle {
  language: OcrLanguage;
  worker: Awaited<ReturnType<TesseractModule["createWorker"]>>;
}

let handlePromise: Promise<WorkerHandle> | null = null;

/** 認識器を用意する。言語が変わったら作り直す。 */
async function getWorker(
  language: OcrLanguage,
  onProgress?: (progress: OcrProgress) => void,
): Promise<WorkerHandle["worker"]> {
  const existing = await handlePromise?.catch(() => null);
  if (existing && existing.language === language) return existing.worker;
  if (existing) {
    await existing.worker.terminate().catch(() => undefined);
    handlePromise = null;
  }

  handlePromise = (async () => {
    const { createWorker } = await loadTesseract();

    const worker = await createWorker(language, 1, {
      workerPath: `${OCR_BASE}worker.min.js`,
      corePath: OCR_BASE,
      langPath: `${OCR_BASE}lang`,
      // 学習データは非圧縮で置いてあるので、展開処理を通さない。
      gzip: false,
      logger: (message: { status: string; progress: number }) => {
        onProgress?.({
          ratio: message.progress,
          label: describeStatus(message.status),
        });
      },
    });

    return { language, worker };
  })().catch((error) => {
    handlePromise = null;
    throw new PdfEditorError(
      "文字認識エンジンを読み込めませんでした。`npm install` で OCR 用のデータが取得できているかご確認ください。",
      { cause: error },
    );
  });

  return (await handlePromise).worker;
}

function describeStatus(status: string): string {
  if (status.includes("loading language")) return "辞書を読み込み中…";
  if (status.includes("initializing")) return "準備中…";
  if (status.includes("recognizing")) return "文字を認識中…";
  return "処理中…";
}

/** 使い終わったら解放する（別の文書へ移るときなど）。 */
export async function disposeOcr(): Promise<void> {
  const existing = await handlePromise?.catch(() => null);
  handlePromise = null;
  await existing?.worker.terminate().catch(() => undefined);
}

/**
 * 1 ページ分の画像を認識し、`PageText` を組み立てる。
 *
 * `canvas` は表示に使っているものと同じ向き・同じ比率で描かれている前提。
 * 返す座標はページに対する比率なので、そのまま既存の機能へ渡せる。
 */
export async function recognizePage(
  canvas: HTMLCanvasElement,
  language: OcrLanguage,
  onProgress?: (progress: OcrProgress) => void,
): Promise<PageText> {
  const worker = await getWorker(language, onProgress);

  let result;
  try {
    result = await worker.recognize(canvas, {}, { blocks: true });
  } catch (error) {
    throw new PdfEditorError("文字の認識に失敗しました。", { cause: error });
  }

  const width = canvas.width;
  const height = canvas.height;

  const chars: CharBox[] = [];
  const offsets: number[] = [];
  let text = "";
  let runIndex = 0;

  // Tesseract は 段落 → 行 → 単語 → 文字 の入れ子で返す。
  // 「行」を 1 つの描画単位として扱うと、ハイライトの帯が自然になる。
  const blocks = result.data.blocks ?? [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const symbols = word.symbols ?? [];

          if (symbols.length > 0) {
            for (const symbol of symbols) {
              const box = symbol.bbox;
              offsets.push(chars.length);
              chars.push({
                char: symbol.text,
                runIndex,
                x: box.x0 / width,
                y: box.y0 / height,
                w: (box.x1 - box.x0) / width,
                h: (box.y1 - box.y0) / height,
              });
              text += symbol.text;
            }
          } else {
            // 文字ごとの情報が無い場合は、単語の枠を文字数で等分する。
            const box = word.bbox;
            const value = word.text;
            const charWidth = (box.x1 - box.x0) / Math.max(1, value.length);
            for (let i = 0; i < value.length; i += 1) {
              offsets.push(chars.length);
              chars.push({
                char: value[i],
                runIndex,
                x: (box.x0 + charWidth * i) / width,
                y: box.y0 / height,
                w: charWidth / width,
                h: (box.y1 - box.y0) / height,
              });
              text += value[i];
            }
          }
        }

        runIndex += 1;
        text += "\n";
      }
    }
  }

  return { text, chars, offsets };
}

/** そのページに文字情報がほとんど無い（＝スキャンの可能性が高い）か。 */
export function looksLikeScan(pageText: PageText): boolean {
  return pageText.chars.length < 8;
}
