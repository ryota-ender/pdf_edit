"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageSizes, loadPdfDocument } from "@/lib/pdf/renderPdf";
import { PdfEditorError, toUserMessage } from "@/lib/pdf/errors";
import type { PageSize } from "@/types/editor";

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  /** 読み込んだままの元データ。書き出し時に pdf-lib へ渡す。 */
  bytes: Uint8Array;
  fileName: string;
  /** 回転を適用する前の各ページ寸法 (ポイント)。 */
  sizes: PageSize[];
  /** 元 PDF が各ページに持っている /Rotate の値。 */
  rotations: number[];
}

export interface PdfDocumentState {
  pdf: LoadedPdf | null;
  isLoading: boolean;
  error: string | null;
  openFile: (file: File) => Promise<LoadedPdf | null>;
  clearError: () => void;
}

const PDF_MIME = "application/pdf";

export function usePdfDocument(): PdfDocumentState {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開いているドキュメントの破棄関数。差し替え時とアンマウント時に呼ぶ。
  const destroyRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    return () => {
      void destroyRef.current?.();
      destroyRef.current = null;
    };
  }, []);

  const openFile = useCallback(async (file: File) => {
    const isPdf = file.type === PDF_MIME || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setError(
        `「${file.name}」はPDFファイルではありません。拡張子が .pdf のファイルを選んでください。`,
      );
      return null;
    }
    if (file.size === 0) {
      setError("ファイルが空です。別のPDFファイルを選んでください。");
      return null;
    }

    setIsLoading(true);
    setError(null);

    let opened: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      opened = await loadPdfDocument(bytes);

      if (opened.doc.numPages === 0) {
        throw new PdfEditorError("このPDFにはページが含まれていません。");
      }

      const { sizes, rotations } = await getPageSizes(opened.doc);
      const loaded: LoadedPdf = {
        doc: opened.doc,
        bytes,
        fileName: file.name,
        sizes,
        rotations,
      };

      // 新しいドキュメントに差し替えてから、直前のものを破棄する。
      const previousDestroy = destroyRef.current;
      destroyRef.current = opened.destroy;
      setPdf(loaded);
      void previousDestroy?.();

      return loaded;
    } catch (cause) {
      // 途中で失敗した分のワーカーを残さない。
      if (opened) void opened.destroy();
      setError(toUserMessage(cause, "PDFの読み込みに失敗しました。"));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { pdf, isLoading, error, openFile, clearError };
}
