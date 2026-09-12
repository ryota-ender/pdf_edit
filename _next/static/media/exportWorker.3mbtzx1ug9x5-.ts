/// <reference lib="webworker" />

import { exportPdf } from "@/lib/pdf/exportPdf";
import type { ExportOptions, ExportResult } from "@/lib/pdf/exportPdf";
import { toUserMessage } from "@/lib/pdf/errors";

/**
 * PDF の書き出しを別スレッドで行う
 * ------------------------------------------------------------------
 * ページ数が多い文書や画像化を伴う書き出しは数秒かかる。メインスレッドで
 * 走らせると操作が固まるので、ここへ追い出す。
 *
 * フォントの取得 (`fetch`) は Worker でもそのまま使える。canvas を要する
 * 処理（保護PDFの画像化）だけは呼び出し側で済ませてから渡してもらう。
 */

export interface ExportWorkerRequest {
  id: number;
  options: ExportOptions;
}

export type ExportWorkerResponse =
  | { id: number; ok: true; result: ExportResult }
  | { id: number; ok: false; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", (event: MessageEvent<ExportWorkerRequest>) => {
  const { id, options } = event.data;

  exportPdf(options).then(
    (result) => {
      const response: ExportWorkerResponse = { id, ok: true, result };
      // バイト列は所有権ごと渡してコピーを避ける。
      scope.postMessage(response, [result.bytes.buffer as ArrayBuffer]);
    },
    (error: unknown) => {
      const response: ExportWorkerResponse = {
        id,
        ok: false,
        message: toUserMessage(error, "PDFの書き出しに失敗しました。"),
      };
      scope.postMessage(response);
    },
  );
});
