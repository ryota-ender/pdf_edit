"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import type { ZoomMode } from "./AppHeader";
import { DocumentView } from "./DocumentView";
import { DropZone } from "./DropZone";
import { Inspector } from "./Inspector";
import { PageRail } from "./PageRail";
import { PdfPageView } from "./PdfPageView";
import type { PageActions } from "./PdfPageView";
import { StatusBanner } from "./StatusBanner";
import type { BannerTone } from "./StatusBanner";
import { ToolRail } from "./ToolRail";
import { useEditorHistory } from "@/hooks/useEditorHistory";
import { useJapaneseFont } from "@/hooks/useJapaneseFont";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { downloadBlob, exportPdf } from "@/lib/pdf/exportPdf";
import { toUserMessage } from "@/lib/pdf/errors";
import {
  CSS_PX_PER_POINT,
  clamp,
  normalizeAngle,
  rotatedPageSize,
} from "@/lib/pdf/coordinates";
import { ImageAssetStore } from "@/lib/pdf/imageAssets";
import {
  INITIAL_STYLE,
  createId,
  createImageElement,
} from "@/lib/pdf/elementDefaults";
import type { StyleDefaults } from "@/lib/pdf/elementDefaults";
import { translateElement } from "@/lib/pdf/geometry";
import type {
  EditorDoc,
  EditorElement,
  RotationDelta,
  ToolId,
} from "@/types/editor";

const EMPTY_DOC: EditorDoc = { pages: [], elements: [] };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

/** ツールごとのキーボードショートカット。 */
const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: "select",
  t: "text",
  h: "highlight",
  p: "pen",
  r: "rect",
  o: "ellipse",
  a: "arrow",
  i: "image",
};

export function PdfEditor() {
  const { pdf, isLoading, error: loadError, openFile, clearError } =
    usePdfDocument();
  const history = useEditorHistory<EditorDoc>(EMPTY_DOC);
  const { state: doc, commit, updateTransient } = history;

  const [tool, setTool] = useState<ToolId>("select");
  const [style] = useState<StyleDefaults>(INITIAL_STYLE);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit-width");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPagePanel, setShowPagePanel] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: BannerTone;
  } | null>(null);

  const { font, error: fontError } = useJapaneseFont(pdf !== null);

  // 画像の実体は履歴に載せず、ここでまとめて面倒を見る。
  // 初期化子付きの useState にすることで、再レンダリングのたびに
  // 作り直されることなく同じインスタンスを持ち回れる。
  const [images] = useState(() => new ImageAssetStore());
  useEffect(() => () => images.dispose(), [images]);

  const scrollToPageRef = useRef<((pageIndex: number) => void) | null>(null);
  const imageTargetRef = useRef<{ pageIndex: number; x: number; y: number } | null>(
    null,
  );
  const imageInputRef = useRef<HTMLInputElement>(null);
  const clipboardRef = useRef<EditorElement[]>([]);

  // ---- ファイルを開く ---------------------------------------------
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
      setSelectedIds([]);
      setEditingId(null);
      setTool("select");
      setZoomMode("fit-width");
      setBanner(null);
    },
    [openFile, reset],
  );

  // ---- ページに関する導出値 ---------------------------------------
  const pageCount = doc.pages.length;
  const activePageIndex = Math.min(currentPage, Math.max(0, pageCount - 1));
  const activePage = doc.pages[activePageIndex] ?? null;

  /** 各ページの「回転を適用した表示寸法」と最終回転角。 */
  const pageViews = useMemo(() => {
    if (!pdf) return [];
    return doc.pages.map((page) => {
      const rotation = normalizeAngle(
        (pdf.rotations[page.sourceIndex] ?? 0) + page.rotation,
      );
      const size = rotatedPageSize(pdf.sizes[page.sourceIndex], rotation);
      return { rotation, width: size.width, height: size.height };
    });
  }, [pdf, doc.pages]);

  /** 表示倍率。fit 系のときは表示領域の広さから毎回求め直す。 */
  const effectiveZoom = useMemo(() => {
    if (zoomMode === "custom" || pageViews.length === 0 || !viewport.width) {
      return zoom;
    }
    const widest = Math.max(...pageViews.map((view) => view.width));
    const tallest = Math.max(...pageViews.map((view) => view.height));
    // ページ周囲の余白ぶんを引いてから収める。
    const availableWidth = viewport.width - 48;
    const availableHeight = viewport.height - 48;

    const byWidth = availableWidth / (widest * CSS_PX_PER_POINT);
    if (zoomMode === "fit-width") return clamp(byWidth, MIN_ZOOM, MAX_ZOOM);

    const byHeight = availableHeight / (tallest * CSS_PX_PER_POINT);
    return clamp(Math.min(byWidth, byHeight), MIN_ZOOM, MAX_ZOOM);
  }, [zoom, zoomMode, pageViews, viewport]);

  const elementsByPage = useMemo(() => {
    const grouped = new Map<number, EditorElement[]>();
    for (const element of doc.elements) {
      const list = grouped.get(element.pageIndex);
      if (list) list.push(element);
      else grouped.set(element.pageIndex, [element]);
    }
    return grouped;
  }, [doc.elements]);

  const elementCounts = useMemo(() => {
    const counts = new Array<number>(pageCount).fill(0);
    for (const element of doc.elements) {
      if (element.pageIndex < counts.length) counts[element.pageIndex] += 1;
    }
    return counts;
  }, [doc.elements, pageCount]);

  const selectedElements = useMemo(
    () => doc.elements.filter((element) => selectedIds.includes(element.id)),
    [doc.elements, selectedIds],
  );

  // ---- 要素の更新 ---------------------------------------------------
  const updateElements = useCallback(
    (
      updater: (elements: EditorElement[]) => EditorElement[],
      transient: boolean,
    ) => {
      const apply = (current: EditorDoc): EditorDoc => ({
        ...current,
        elements: updater(current.elements),
      });
      if (transient) updateTransient(apply);
      else commit(apply);
    },
    [commit, updateTransient],
  );

  const patchSelected = useCallback(
    (patch: Partial<EditorElement>, transient: boolean) => {
      if (selectedIds.length === 0) return;
      updateElements(
        (elements) =>
          elements.map((element) =>
            selectedIds.includes(element.id)
              ? ({ ...element, ...patch } as EditorElement)
              : element,
          ),
        transient,
      );
    },
    [selectedIds, updateElements],
  );

  const addElement = useCallback(
    (element: EditorElement, transient: boolean) => {
      updateElements((elements) => [...elements, element], transient);
    },
    [updateElements],
  );

  const removeElement = useCallback(
    (id: string) => {
      // 図形を描き損ねたときの後始末。履歴は呼び出し側が締める。
      updateElements(
        (elements) => elements.filter((element) => element.id !== id),
        true,
      );
    },
    [updateElements],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    updateElements(
      (elements) => elements.filter((element) => !selectedIds.includes(element.id)),
      false,
    );
    setSelectedIds([]);
    setEditingId(null);
  }, [selectedIds, updateElements]);

  const duplicateSelected = useCallback(() => {
    if (selectedElements.length === 0) return;
    const copies = selectedElements.map((element) =>
      translateElement({ ...element, id: createId(element.type) }, 0.02, 0.02),
    );
    updateElements((elements) => [...elements, ...copies], false);
    setSelectedIds(copies.map((element) => element.id));
  }, [selectedElements, updateElements]);

  // ---- テキスト編集 -------------------------------------------------
  const startEditing = useCallback(
    (id: string) => {
      setSelectedIds([id]);
      setEditingId(id);
      history.beginTransaction();
    },
    [history],
  );

  const previewText = useCallback(
    (id: string, text: string) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id && element.type === "text"
              ? { ...element, text }
              : element,
          ),
        true,
      );
    },
    [updateElements],
  );

  const finishEdit = useCallback(
    (id: string, text: string) => {
      setEditingId((previous) => (previous === id ? null : previous));

      // 空のまま確定した要素は残さない。
      if (text.trim().length === 0) {
        updateElements(
          (elements) => elements.filter((element) => element.id !== id),
          true,
        );
        setSelectedIds((previous) => previous.filter((value) => value !== id));
        history.endTransaction();
        return;
      }

      previewText(id, text);
      history.endTransaction();
    },
    [history, previewText, updateElements],
  );

  const stopEditing = useCallback(() => {
    setEditingId(null);
    history.endTransaction();
  }, [history]);

  // ---- 画像の挿入 ---------------------------------------------------
  const requestImage = useCallback(
    (pageIndex: number, x: number, y: number) => {
      imageTargetRef.current = { pageIndex, x, y };
      imageInputRef.current?.click();
    },
    [],
  );

  const handleImageSelected = useCallback(
    async (file: File) => {
      const target = imageTargetRef.current;
      imageTargetRef.current = null;
      if (!target) return;

      const view = pageViews[target.pageIndex];
      if (!view) return;

      try {
        const asset = await images.add(file);

        // ページ幅の 35% を基準に、元の縦横比を保って置く。
        const width = 0.35;
        const widthPt = width * view.width;
        const heightPt = (widthPt * asset.height) / asset.width;
        const height = heightPt / view.height;

        const element = createImageElement(
          target.pageIndex,
          {
            x: clamp(target.x, 0, Math.max(0, 1 - width)),
            y: clamp(target.y, 0, Math.max(0, 1 - height)),
            w: width,
            h: height,
          },
          asset.id,
        );

        addElement(element, false);
        setSelectedIds([element.id]);
        setTool("select");
      } catch (error) {
        setBanner({
          message: toUserMessage(error, "画像の読み込みに失敗しました。"),
          tone: "error",
        });
      }
    },
    [addElement, images, pageViews],
  );

  // ---- ページ操作 ---------------------------------------------------
  const rotatePage = useCallback(
    (index: number) => {
      commit((current) => ({
        ...current,
        pages: current.pages.map((page, i) =>
          i === index
            ? { ...page, rotation: ((page.rotation + 90) % 360) as RotationDelta }
            : page,
        ),
      }));
    },
    [commit],
  );

  const deletePage = useCallback(
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
      setSelectedIds([]);
      setEditingId(null);
    },
    [commit, pageCount],
  );

  const duplicatePage = useCallback(
    (index: number) => {
      commit((current) => {
        const pages = [...current.pages];
        pages.splice(index + 1, 0, { ...pages[index] });

        // 複製したページより後ろの要素は 1 つ後ろへずらし、
        // 複製元の要素は新しいページにも複製する。
        const shifted = current.elements.map((element) =>
          element.pageIndex > index
            ? { ...element, pageIndex: element.pageIndex + 1 }
            : element,
        );
        const copies = current.elements
          .filter((element) => element.pageIndex === index)
          .map((element) => ({
            ...element,
            id: createId(element.type),
            pageIndex: index + 1,
          }));

        return { pages, elements: [...shifted, ...copies] };
      });
      setSelectedIds([]);
    },
    [commit],
  );

  const movePage = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= pageCount) return;

      commit((current) => {
        const pages = [...current.pages];
        [pages[index], pages[target]] = [pages[target], pages[index]];

        // 入れ替えた 2 ページの要素も一緒に移す。
        const elements = current.elements.map((element) => {
          if (element.pageIndex === index) {
            return { ...element, pageIndex: target };
          }
          if (element.pageIndex === target) {
            return { ...element, pageIndex: index };
          }
          return element;
        });

        return { pages, elements };
      });
      setCurrentPage(target);
    },
    [commit, pageCount],
  );

  // ---- 書き出し -----------------------------------------------------
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
        images,
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
  }, [doc, images, pdf]);

  // ---- ページ移動 ---------------------------------------------------
  const goToPage = useCallback(
    (index: number) => {
      const next = clamp(index, 0, Math.max(0, pageCount - 1));
      setCurrentPage(next);
      scrollToPageRef.current?.(next);
      stopEditing();
    },
    [pageCount, stopEditing],
  );

  const registerScrollToPage = useCallback(
    (scrollTo: (pageIndex: number) => void) => {
      scrollToPageRef.current = scrollTo;
    },
    [],
  );

  const handleZoomGesture = useCallback((delta: number) => {
    setZoomMode("custom");
    setZoom((previous) =>
      clamp(previous * (1 + delta / 500), MIN_ZOOM, MAX_ZOOM),
    );
  }, []);

  const handleZoomChange = useCallback((next: number) => {
    setZoomMode("custom");
    setZoom(next);
  }, []);

  // ---- キーボード ---------------------------------------------------
  const { undo, redo } = history;
  useEffect(() => {
    if (!pdf) return;

    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (isTextEntry) return;

      if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(
          (elementsByPage.get(activePageIndex) ?? []).map(
            (element) => element.id,
          ),
        );
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (modifier && event.key.toLowerCase() === "c") {
        clipboardRef.current = selectedElements;
        return;
      }
      if (modifier && event.key.toLowerCase() === "v") {
        if (clipboardRef.current.length === 0) return;
        event.preventDefault();
        const copies = clipboardRef.current.map((element) =>
          translateElement(
            { ...element, id: createId(element.type), pageIndex: activePageIndex },
            0.03,
            0.03,
          ),
        );
        updateElements((elements) => [...elements, ...copies], false);
        setSelectedIds(copies.map((element) => element.id));
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.length > 0) {
          event.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (event.key === "Escape") {
        setSelectedIds([]);
        stopEditing();
        setTool("select");
        return;
      }

      // 矢印キーで微調整。Shift で大きく動かす。
      if (event.key.startsWith("Arrow") && selectedIds.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 0.01 : 0.002;
        const dx =
          event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy =
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;

        history.beginTransaction();
        updateElements(
          (elements) =>
            elements.map((element) =>
              selectedIds.includes(element.id)
                ? translateElement(element, dx, dy)
                : element,
            ),
          true,
        );
        history.endTransaction();
        return;
      }

      const shortcut = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (shortcut && !modifier) setTool(shortcut);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    pdf,
    redo,
    undo,
    history,
    selectedIds,
    selectedElements,
    activePageIndex,
    elementsByPage,
    deleteSelected,
    duplicateSelected,
    stopEditing,
    updateElements,
  ]);

  const handleRenderError = useCallback((message: string) => {
    setBanner({ message, tone: "error" });
  }, []);

  const actions = useMemo<PageActions>(
    () => ({
      beginTransaction: history.beginTransaction,
      endTransaction: history.endTransaction,
      updateElements,
      addElement,
      removeElement,
      setSelection: setSelectedIds,
      startEditing,
      previewText,
      finishEdit,
      requestImage,
      onRenderError: handleRenderError,
    }),
    [
      history.beginTransaction,
      history.endTransaction,
      updateElements,
      addElement,
      removeElement,
      startEditing,
      previewText,
      finishEdit,
      requestImage,
      handleRenderError,
    ],
  );

  // ---- 描画 ----------------------------------------------------------
  if (!pdf) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader
          fileName={null}
          onOpenFile={handleOpenFile}
          onExport={handleExport}
          isExporting={false}
          canExport={false}
          showPagePanel={showPagePanel}
          onTogglePagePanel={() => setShowPagePanel((value) => !value)}
          canUndo={false}
          canRedo={false}
          onUndo={undo}
          onRedo={redo}
          zoom={zoom}
          zoomMode={zoomMode}
          onZoomChange={handleZoomChange}
          onZoomModeChange={setZoomMode}
          pageIndex={0}
          pageCount={1}
          onPageChange={goToPage}
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
      <AppHeader
        fileName={pdf.fileName}
        onOpenFile={handleOpenFile}
        onExport={handleExport}
        isExporting={isExporting}
        canExport
        showPagePanel={showPagePanel}
        onTogglePagePanel={() => setShowPagePanel((value) => !value)}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        zoom={effectiveZoom}
        zoomMode={zoomMode}
        onZoomChange={handleZoomChange}
        onZoomModeChange={setZoomMode}
        pageIndex={activePageIndex}
        pageCount={pageCount}
        onPageChange={goToPage}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail tool={tool} onSelect={setTool} />

        {showPagePanel && (
          <PageRail
            doc={pdf.doc}
            pages={doc.pages}
            sizes={pdf.sizes}
            baseRotations={pdf.rotations}
            currentPage={activePageIndex}
            onSelectPage={goToPage}
            onRotatePage={rotatePage}
            onDeletePage={deletePage}
            onDuplicatePage={duplicatePage}
            onMovePage={movePage}
            elementCounts={elementCounts}
          />
        )}

        <DocumentView
          onViewportResize={setViewport}
          onVisiblePageChange={setCurrentPage}
          registerScrollToPage={registerScrollToPage}
          onZoomGesture={handleZoomGesture}
        >
          {doc.pages.map((page, index) => {
            const view = pageViews[index];
            if (!view) return null;
            return (
              <PdfPageView
                key={`${page.sourceIndex}-${index}`}
                doc={pdf.doc}
                pageIndex={index}
                sourceIndex={page.sourceIndex}
                rotation={view.rotation}
                view={view}
                zoom={effectiveZoom}
                elements={elementsByPage.get(index) ?? []}
                selectedIds={selectedIds}
                editingId={editingId}
                tool={tool}
                style={style}
                font={font}
                images={images}
                actions={actions}
              />
            );
          })}
        </DocumentView>

        <Inspector
          selected={selectedElements}
          page={activePage}
          pageIndex={activePageIndex}
          pageCount={pageCount}
          onPreview={(patch) => patchSelected(patch, true)}
          onCommit={(patch) => patchSelected(patch, false)}
          onBeginTransaction={history.beginTransaction}
          onEndTransaction={history.endTransaction}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onRotatePage={() => rotatePage(activePageIndex)}
          onDeletePage={() => deletePage(activePageIndex)}
        />
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          event.target.value = "";
          if (file) void handleImageSelected(file);
        }}
      />

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
