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
  close: () => void;
  clearError: () => void;
}

const PDF_MIME = "application/pdf";

export function usePdfDocument(): PdfDocumentState {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // アンマウント時に pdf.js のワーカーを確実に片付けるため、最新の
  // ドキュメントを ref にも持っておく。
  const currentDocRef = useRef<PDFDocumentProxy | null>(null);
  useEffect(() => {
    currentDocRef.current = pdf?.doc ?? null;
  }, [pdf]);

  useEffect(() => {
    return () => {
      void currentDocRef.current?.destroy();
      currentDocRef.current = null;
    };
  }, []);

  const openFile = useCallback(async (file: File) => {
    const isPdf =
      file.type === PDF_MIME || /\.pdf$/i.test(file.name);
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

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await loadPdfDocument(bytes);

      if (doc.numPages === 0) {
        await doc.destroy();
        throw new PdfEditorError("このPDFにはページが含まれていません。");
      }

      const { sizes, rotations } = await getPageSizes(doc);
      const loaded: LoadedPdf = {
        doc,
        bytes,
        fileName: file.name,
        sizes,
        rotations,
      };

      // 直前に開いていたドキュメントを破棄してから差し替える。
      const previous = currentDocRef.current;
      currentDocRef.current = doc;
      setPdf(loaded);
      if (previous) void previous.destroy();

      return loaded;
    } catch (cause) {
      setError(toUserMessage(cause, "PDFの読み込みに失敗しました。"));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    const previous = currentDocRef.current;
    currentDocRef.current = null;
    setPdf(null);
    setError(null);
    if (previous) void previous.destroy();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { pdf, isLoading, error, openFile, close, clearError };
}
