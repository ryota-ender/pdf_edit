import { exportPdf } from "./exportPdf";
import type { ExportOptions, ExportResult } from "./exportPdf";
import type {
  ExportWorkerRequest,
  ExportWorkerResponse,
} from "@/workers/exportWorker";

/**
 * 書き出しの実行係。
 *
 * まず Worker で走らせ、Worker が使えない環境ではメインスレッドで
 * そのまま実行する。呼び出し側はどちらで動いたかを気にしなくてよい。
 */

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;

  try {
    worker = new Worker(new URL("../../workers/exportWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("error", () => {
      // 一度でも壊れたら、以後はメインスレッドで処理する。
      workerBroken = true;
      worker?.terminate();
      worker = null;
    });
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

export async function runExport(
  options: ExportOptions,
): Promise<ExportResult> {
  const instance = getWorker();
  if (!instance) return exportPdf(options);

  const id = nextId++;

  return new Promise<ExportResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent<ExportWorkerResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.message));
    };

    const onError = () => {
      cleanup();
      // Worker が落ちた場合はメインスレッドで再挑戦する。
      exportPdf(options).then(resolve, reject);
    };

    const cleanup = () => {
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
    };

    instance.addEventListener("message", onMessage);
    instance.addEventListener("error", onError);

    const request: ExportWorkerRequest = { id, options };
    instance.postMessage(request);
  });
}

/** 書き出した中身をダウンロードさせる。 */
export function toBlob(bytes: Uint8Array): Blob {
  // pdf-lib が返す Uint8Array は SharedArrayBuffer 由来の可能性を
  // 型上排除できないため、実体をコピーしてから Blob にする。
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: "application/pdf" });
}
