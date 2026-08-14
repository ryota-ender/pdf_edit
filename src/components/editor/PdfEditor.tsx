"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropZone } from "./DropZone";
import { Header } from "./Header";
import { PageSidebar } from "./PageSidebar";
import { PdfCanvas } from "./PdfCanvas";
import { PdfPage } from "./PdfPage";
import { PropertiesPanel } from "./PropertiesPanel";
import { StatusBanner } from "./StatusBanner";
import type { BannerTone } from "./StatusBanner";
import { Toolbar } from "./Toolbar";
import { useEditorHistory } from "@/hooks/useEditorHistory";
import { useJapaneseFont } from "@/hooks/useJapaneseFont";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { downloadBlob, exportPdf } from "@/lib/pdf/exportPdf";
import { toUserMessage } from "@/lib/pdf/errors";
import { clamp, normalizeAngle, rotatedPageSize } from "@/lib/pdf/coordinates";
import {
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT,
  layoutTextBlock,
} from "@/lib/pdf/textLayout";
import type {
  EditorDoc,
  RotationDelta,
  TextElement,
  ToolId,
} from "@/types/editor";

const EMPTY_DOC: EditorDoc = { pages: [], elements: [] };

export function PdfEditor() {
  const { pdf, isLoading, error: loadError, openFile, clearError } =
    usePdfDocument();
  const history = useEditorHistory<EditorDoc>(EMPTY_DOC);
  const { state: doc, commit, updateTransient } = history;

  const [tool, setTool] = useState<ToolId>("select");
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: BannerTone;
  } | null>(null);

  // フォントはエディタを開いたタイミングで取りに行く。
  const { font, error: fontError } = useJapaneseFont(pdf !== null);

  const { reset } = history;
  const handleOpenFile = useCallback(
    async (file: File) => {
      const loaded = await openFile(file);
      if (!loaded) return;

      reset({
        pages: loaded.sizes.map((_, index) => ({
          sourceIndex: index,
          rotation: 0,
        })),
        elements: [],
      });
      setCurrentPage(0);
      setSelectedId(null);
      setEditingId(null);
      setTool("select");
      setBanner(null);
    },
    [openFile, reset],
  );

  // ---- 現在のページに関する導出値 -------------------------------
  const pageCount = doc.pages.length;
  const activePageIndex = Math.min(currentPage, Math.max(0, pageCount - 1));
  const activePage = doc.pages[activePageIndex] ?? null;

  const pageView = useMemo(() => {
    if (!pdf || !activePage) return null;
    const baseRotation = pdf.rotations[activePage.sourceIndex] ?? 0;
    const rotation = normalizeAngle(baseRotation + activePage.rotation);
    const size = rotatedPageSize(pdf.sizes[activePage.sourceIndex], rotation);
    return { rotation, width: size.width, height: size.height };
  }, [pdf, activePage]);

  const pageElements = useMemo(
    () => doc.elements.filter((element) => element.pageIndex === activePageIndex),
    [doc.elements, activePageIndex],
  );

  const elementCounts = useMemo(() => {
    const counts = new Array<number>(pageCount).fill(0);
    for (const element of doc.elements) {
      if (element.pageIndex < counts.length) counts[element.pageIndex] += 1;
    }
    return counts;
  }, [doc.elements, pageCount]);

  const selectedElement = useMemo(
    () => doc.elements.find((element) => element.id === selectedId) ?? null,
    [doc.elements, selectedId],
  );

  // ---- 要素の操作 -----------------------------------------------
  const patchElement = useCallback(
    (id: string, patch: Partial<TextElement>, transient: boolean) => {
      const apply = (current: EditorDoc): EditorDoc => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === id ? { ...element, ...patch } : element,
        ),
      });
      if (transient) updateTransient(apply);
      else commit(apply);
    },
    [commit, updateTransient],
  );

  const handleAddText = useCallback(
    (normalizedX: number, normalizedY: number) => {
      if (!pageView) return;

      const id =
        globalThis.crypto?.randomUUID?.() ??
        `text-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const element: TextElement = {
        id,
        type: "text",
        pageIndex: activePageIndex,
        x: normalizedX,
        y: normalizedY,
        text: DEFAULT_TEXT,
        fontSize: DEFAULT_FONT_SIZE,
        color: DEFAULT_COLOR,
      };

      // 追加位置がページ右下すぎると文字がはみ出すので、収まる位置へ寄せる。
      const layout = layoutTextBlock(element.text, element.fontSize, font);
      element.x = clamp(
        element.x,
        0,
        Math.max(0, (pageView.width - layout.width) / pageView.width),
      );
      element.y = clamp(
        element.y,
        0,
        Math.max(0, (pageView.height - layout.height) / pageView.height),
      );

      commit((current) => ({
        ...current,
        elements: [...current.elements, element],
      }));
      setSelectedId(id);
      setEditingId(id);
      setTool("select");
    },
    [activePageIndex, commit, font, pageView],
  );

  const handleDeleteElement = useCallback(
    (id: string) => {
      commit((current) => ({
        ...current,
        elements: current.elements.filter((element) => element.id !== id),
      }));
      setSelectedId((previous) => (previous === id ? null : previous));
      setEditingId((previous) => (previous === id ? null : previous));
    },
    [commit],
  );

  const handleFinishEdit = useCallback(
    (id: string, text: string) => {
      setEditingId(null);
      // 空文字のまま確定した要素は残さない。
      if (text.trim().length === 0) {
        handleDeleteElement(id);
        return;
      }
      // 入力中は updateTransient で反映済み。ここで履歴に 1 件だけ積む。
      history.endTransaction();
      patchElement(id, { text }, false);
    },
    [handleDeleteElement, history, patchElement],
  );

  // ---- ページの操作 ---------------------------------------------
  const handleRotatePage = useCallback(
    (index: number) => {
      commit((current) => ({
        ...current,
        pages: current.pages.map((page, i) =>
          i === index
            ? {
                ...page,
                rotation: (((page.rotation + 90) % 360) as RotationDelta),
              }
            : page,
        ),
      }));
    },
    [commit],
  );

  const handleDeletePage = useCallback(
    (index: number) => {
      if (pageCount <= 1) return;

      commit((current) => ({
        pages: current.pages.filter((_, i) => i !== index),
        // 削除したページの要素は捨て、後ろのページの参照を 1 つ前へ詰める。
        elements: current.elements
          .filter((element) => element.pageIndex !== index)
          .map((element) =>
            element.pageIndex > index
              ? { ...element, pageIndex: element.pageIndex - 1 }
              : element,
          ),
      }));

      setCurrentPage((previous) =>
        clamp(previous > index ? previous - 1 : previous, 0, pageCount - 2),
      );
      setSelectedId(null);
      setEditingId(null);
    },
    [commit, pageCount],
  );

  // ---- 書き出し -------------------------------------------------
  // 連打での多重実行を止める。state だけだと同一フレームの再クリックを取り逃す。
  const isExportingRef = useRef(false);

  const handleExport = useCallback(async () => {
    if (!pdf || isExportingRef.current) return;

    isExportingRef.current = true;
    setIsExporting(true);
    setBanner(null);

    try {
      const result = await exportPdf({
        originalBytes: pdf.bytes,
        doc,
        originalFileName: pdf.fileName,
      });
      downloadBlob(result.blob, result.fileName);
      setBanner({
        message: result.usedFullFontEmbed
          ? `${result.fileName} を書き出しました。（フォントを全体埋め込みしたためサイズが大きくなっています）`
          : `${result.fileName} を書き出しました。`,
        tone: "info",
      });
    } catch (error) {
      setBanner({
        message: toUserMessage(error, "PDFの書き出しに失敗しました。"),
        tone: "error",
      });
    } finally {
      isExportingRef.current = false;
      setIsExporting(false);
    }
  }, [doc, pdf]);

  // ---- キーボードショートカット ---------------------------------
  const { undo, redo } = history;
  useEffect(() => {
    if (!pdf) return;

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (isTextEntry) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedId) {
          event.preventDefault();
          handleDeleteElement(selectedId);
        }
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        setEditingId(null);
        return;
      }
      if (event.key === "v" || event.key === "V") setTool("select");
      if (event.key === "t" || event.key === "T") setTool("text");
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pdf, redo, undo, selectedId, handleDeleteElement]);

  const handleRenderError = useCallback((message: string) => {
    setBanner({ message, tone: "error" });
  }, []);

  // ---- 描画 ------------------------------------------------------
  if (!pdf) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header
          fileName={null}
          onOpenFile={handleOpenFile}
          onExport={handleExport}
          isExporting={false}
          canExport={false}
        />
        <DropZone
          onFile={handleOpenFile}
          isLoading={isLoading}
          error={loadError}
          onDismissError={clearError}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        fileName={pdf.fileName}
        onOpenFile={handleOpenFile}
        onExport={handleExport}
        isExporting={isExporting}
        canExport
      />

      <Toolbar
        tool={tool}
        onToolChange={setTool}
        zoom={zoom}
        onZoomChange={setZoom}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        pageIndex={activePageIndex}
        pageCount={pageCount}
        onPageChange={(index) => {
          setCurrentPage(clamp(index, 0, pageCount - 1));
          setEditingId(null);
        }}
      />

      <div className="flex min-h-0 flex-1">
        <PageSidebar
          doc={pdf.doc}
          pages={doc.pages}
          sizes={pdf.sizes}
          baseRotations={pdf.rotations}
          currentPage={activePageIndex}
          onSelectPage={(index) => {
            setCurrentPage(index);
            setEditingId(null);
          }}
          onRotatePage={handleRotatePage}
          onDeletePage={handleDeletePage}
          elementCounts={elementCounts}
        />

        <PdfCanvas>
          {activePage && pageView && (
            <PdfPage
              doc={pdf.doc}
              sourceIndex={activePage.sourceIndex}
              rotation={pageView.rotation}
              viewWidth={pageView.width}
              viewHeight={pageView.height}
              zoom={zoom}
              elements={pageElements}
              selectedId={selectedId}
              editingId={editingId}
              tool={tool}
              font={font}
              onAddText={handleAddText}
              onSelect={setSelectedId}
              onStartEdit={(id) => {
                setSelectedId(id);
                setEditingId(id);
                history.beginTransaction();
              }}
              onMoveStart={history.beginTransaction}
              onMove={(id, x, y) => patchElement(id, { x, y }, true)}
              onMoveEnd={history.endTransaction}
              onPreviewText={(id, text) => patchElement(id, { text }, true)}
              onFinishEdit={handleFinishEdit}
              onRenderError={handleRenderError}
            />
          )}
        </PdfCanvas>

        <PropertiesPanel
          element={selectedElement}
          page={activePage}
          pageIndex={activePageIndex}
          pageCount={pageCount}
          onPreview={(patch) =>
            selectedId && patchElement(selectedId, patch, true)
          }
          onCommit={(patch) =>
            selectedId && patchElement(selectedId, patch, false)
          }
          onBeginTransaction={history.beginTransaction}
          onEndTransaction={history.endTransaction}
          onDelete={() => selectedId && handleDeleteElement(selectedId)}
          onRotatePage={() => handleRotatePage(activePageIndex)}
          onDeletePage={() => handleDeletePage(activePageIndex)}
        />
      </div>

      {(banner || loadError || fontError) && (
        <StatusBanner
          message={loadError ?? banner?.message ?? fontError ?? ""}
          tone={loadError || fontError ? "error" : (banner?.tone ?? "info")}
          onDismiss={() => {
            clearError();
            setBanner(null);
          }}
        />
      )}
    </div>
  );
}
