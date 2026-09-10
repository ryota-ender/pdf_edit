"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  PasswordRequiredError,
  getPageSizes,
  loadPdfDocument,
} from "@/lib/pdf/renderPdf";
import { PdfEditorError, toUserMessage } from "@/lib/pdf/errors";
import { createId } from "@/lib/pdf/elementDefaults";
import type { StoredSource } from "@/lib/pdf/persistence";
import type { PageSize } from "@/types/editor";

/** 読み込み済みの PDF ファイル 1 つ分。 */
export interface LoadedSource {
  id: string;
  doc: PDFDocumentProxy;
  /** 読み込んだままの元データ。書き出し時に pdf-lib へ渡す。 */
  bytes: Uint8Array;
  fileName: string;
  /** 回転を適用する前の各ページ寸法 (ポイント)。 */
  sizes: PageSize[];
  /** 元 PDF が各ページに持っている /Rotate の値。 */
  rotations: number[];
}

export interface PasswordPrompt {
  /** 再挑戦のために、開こうとしたファイルそのものを持っておく。 */
  file: File;
  fileName: string;
  wasWrong: boolean;
  /** 結合として開こうとしていたか。 */
  append: boolean;
}

export interface PdfDocumentState {
  sources: LoadedSource[];
  isLoading: boolean;
  error: string | null;
  passwordPrompt: PasswordPrompt | null;
  /** `append` を付けると、開いているPDFの後ろへ結合する。 */
  openFile: (
    file: File,
    options?: { append?: boolean; password?: string },
  ) => Promise<LoadedSource | null>;
  /** 自動保存から復帰する。 */
  restoreSources: (stored: StoredSource[]) => Promise<LoadedSource[] | null>;
  cancelPassword: () => void;
  clearError: () => void;
  closeAll: () => void;
}

const PDF_MIME = "application/pdf";

export function usePdfDocument(): PdfDocumentState {
  const [sources, setSources] = useState<LoadedSource[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(
    null,
  );

  // 開いているドキュメントの破棄関数。差し替え時とアンマウント時に呼ぶ。
  const destroyersRef = useRef(new Map<string, () => Promise<void>>());

  useEffect(() => {
    const destroyers = destroyersRef.current;
    return () => {
      for (const destroy of destroyers.values()) void destroy();
      destroyers.clear();
    };
  }, []);

  /**
   * 読み込み済みドキュメントを破棄する。
   * `keep` に挙げた id は残す。新しく開いたものまで一緒に壊さないための引数で、
   * これが無いと差し替え時に「今読み込んだばかりの文書」を破棄してしまう。
   */
  const disposeExcept = useCallback((keep: string[] = []) => {
    for (const [id, destroy] of destroyersRef.current) {
      if (keep.includes(id)) continue;
      void destroy();
      destroyersRef.current.delete(id);
    }
  }, []);

  const readSource = useCallback(
    async (
      bytes: Uint8Array,
      fileName: string,
      password: string | undefined,
      id: string,
    ): Promise<LoadedSource> => {
      const opened = await loadPdfDocument(bytes, password);
      try {
        if (opened.doc.numPages === 0) {
          throw new PdfEditorError("このPDFにはページが含まれていません。");
        }
        const { sizes, rotations } = await getPageSizes(opened.doc);
        destroyersRef.current.set(id, opened.destroy);
        return { id, doc: opened.doc, bytes, fileName, sizes, rotations };
      } catch (error) {
        void opened.destroy();
        throw error;
      }
    },
    [],
  );

  const openFile = useCallback<PdfDocumentState["openFile"]>(
    async (file, options = {}) => {
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

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const source = await readSource(
          bytes,
          file.name,
          options.password,
          createId("src"),
        );

        setPasswordPrompt(null);

        if (options.append) {
          setSources((previous) => [...previous, source]);
        } else {
          disposeExcept([source.id]);
          setSources([source]);
        }
        return source;
      } catch (cause) {
        if (cause instanceof PasswordRequiredError) {
          // 入力を促す。実際の再読み込みは呼び出し側が行う
          // （ページ構成の初期化まで含めて同じ経路を通す必要があるため）。
          setPasswordPrompt({
            file,
            fileName: file.name,
            wasWrong: cause.wasWrong,
            append: options.append ?? false,
          });
          return null;
        }
        setError(toUserMessage(cause, "PDFの読み込みに失敗しました。"));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [disposeExcept, readSource],
  );

  const restoreSources = useCallback<PdfDocumentState["restoreSources"]>(
    async (stored) => {
      setIsLoading(true);
      setError(null);
      try {
        const restored: LoadedSource[] = [];
        for (const item of stored) {
          restored.push(
            await readSource(item.bytes, item.fileName, undefined, item.id),
          );
        }
        disposeExcept(restored.map((source) => source.id));
        setSources(restored);
        return restored;
      } catch (cause) {
        setError(toUserMessage(cause, "保存内容の復元に失敗しました。"));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [disposeExcept, readSource],
  );

  const cancelPassword = useCallback(() => {
    setPasswordPrompt(null);
  }, []);

  const closeAll = useCallback(() => {
    disposeExcept();
    setSources([]);
    setError(null);
    setPasswordPrompt(null);
  }, [disposeExcept]);

  const clearError = useCallback(() => setError(null), []);

  return {
    sources,
    isLoading,
    error,
    passwordPrompt,
    openFile,
    restoreSources,
    cancelPassword,
    clearError,
    closeAll,
  };
}
