"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import type { ZoomMode } from "./AppHeader";
import { PasswordDialog, PromptDialog, RestoreDialog } from "./Dialogs";
import { DocumentView } from "./DocumentView";
import { DropZone } from "./DropZone";
import { Inspector } from "./Inspector";
import { PageRail } from "./PageRail";
import { PdfPageView } from "./PdfPageView";
import { SearchBar } from "./SearchBar";
import { StatusBanner } from "./StatusBanner";
import type { BannerTone } from "./StatusBanner";
import { ToolRail } from "./ToolRail";
import { useAutosave } from "@/hooks/useAutosave";
import { useEditorHistory } from "@/hooks/useEditorHistory";
import { useFontBook } from "@/hooks/useFontBook";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import type { LoadedSource } from "@/hooks/usePdfDocument";
import type { PageActions } from "@/hooks/usePageInteraction";
import { downloadBlob, exportPdf } from "@/lib/pdf/exportPdf";
import type { ExportMode } from "@/lib/pdf/exportPdf";
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
  createTextElement,
  createWhiteoutElement,
  deriveStyle,
} from "@/lib/pdf/elementDefaults";
import type { StyleDefaults } from "@/lib/pdf/elementDefaults";
import {
  alignOffsets,
  distributeOffsets,
  elementBoundingRect,
  translateElement,
  unionRect,
} from "@/lib/pdf/geometry";
import type { AlignMode } from "@/lib/pdf/geometry";
import { TextLayerCache, findInPage, selectLines, selectedText } from "@/lib/pdf/textLayer";
import type { SearchMatch } from "@/lib/pdf/textLayer";
import {
  clearSession,
  describeSession,
  loadSession,
} from "@/lib/pdf/persistence";
import type { StoredSession } from "@/lib/pdf/persistence";
import {
  createStamp,
  deleteStamp,
  instantiateStamp,
  loadStamps,
  saveStamp,
} from "@/lib/pdf/stamps";
import type { SavedStamp } from "@/lib/pdf/stamps";
import type {
  EditorDoc,
  EditorElement,
  NormalizedRect,
  RotationDelta,
  ToolId,
} from "@/types/editor";

const EMPTY_DOC: EditorDoc = { pages: [], elements: [] };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: "select",
  t: "text",
  h: "highlight",
  p: "pen",
  r: "rect",
  o: "ellipse",
  a: "arrow",
  i: "image",
  e: "textEdit",
};

export function PdfEditor() {
  const {
    sources,
    isLoading,
    error: loadError,
    passwordPrompt,
    openFile,
    restoreSources,
    cancelPassword,
    clearError,
  } = usePdfDocument();

  const history = useEditorHistory<EditorDoc>(EMPTY_DOC);
  const { state: doc, commit, updateTransient } = history;

  const [tool, setTool] = useState<ToolId>("select");
  const [style, setStyle] = useState<StyleDefaults>(INITIAL_STYLE);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit-width");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPagePanel, setShowPagePanel] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("flatten");
  const [snapEnabled] = useState(true);
  // localStorage は初期化子の中で一度だけ読む（読めない環境では空配列）。
  const [stamps, setStamps] = useState<SavedStamp[]>(() => loadStamps());
  const [stampPrompt, setStampPrompt] = useState(false);
  const [restorable, setRestorable] = useState<StoredSession | null>(null);
  const [banner, setBanner] = useState<{
    message: string;
    tone: BannerTone;
  } | null>(null);

  // 検索
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const hasDocument = sources.length > 0;
  const { fonts, error: fontError, requestWeight } = useFontBook(hasDocument);

  // 画像の実体は履歴に載せず、ここでまとめて面倒を見る。
  const [images] = useState(() => new ImageAssetStore());
  useEffect(() => () => images.dispose(), [images]);

  const scrollToPageRef = useRef<((pageIndex: number) => void) | null>(null);
  const imageTargetRef = useRef<{ pageIndex: number; x: number; y: number } | null>(
    null,
  );
  const imageInputRef = useRef<HTMLInputElement>(null);
  const clipboardRef = useRef<EditorElement[]>([]);
  // ページの文字位置は取り出すのに時間がかかるので、ファイルごとに覚えておく。
  const textLayersRef = useRef(new Map<string, TextLayerCache>());

  // --- 自動保存 -----------------------------------------------------
  const storedSources = useMemo(
    () =>
      sources.map((source) => ({
        id: source.id,
        fileName: source.fileName,
        bytes: source.bytes,
      })),
    [sources],
  );
  const saveState = useAutosave({
    enabled: hasDocument,
    doc,
    sources: storedSources,
    images,
  });

  // 起動時に前回の続きがあるか調べる。
  useEffect(() => {
    let cancelled = false;
    loadSession().then((session) => {
      if (!cancelled && session && session.sources.length > 0) {
        setRestorable(session);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- ファイルを開く / 結合する ------------------------------------
  const { reset } = history;

  const handleOpenFile = useCallback(
    async (file: File, password?: string) => {
      const loaded = await openFile(file, { password });
      if (!loaded) return;

      textLayersRef.current.clear();
      reset({
        pages: loaded.sizes.map((_, index) => ({
          sourceId: loaded.id,
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
      setRestorable(null);
    },
    [openFile, reset],
  );

  const handleMergeFile = useCallback(
    async (file: File, password?: string) => {
      const loaded = await openFile(file, { append: true, password });
      if (!loaded) return;

      commit((current) => ({
        ...current,
        pages: [
          ...current.pages,
          ...loaded.sizes.map((_, index) => ({
            sourceId: loaded.id,
            sourceIndex: index,
            rotation: 0 as RotationDelta,
          })),
        ],
      }));
      setBanner({
        message: `${loaded.fileName} を ${loaded.sizes.length} ページ結合しました。`,
        tone: "info",
      });
    },
    [commit, openFile],
  );

  /**
   * pdf-lib が読めないファイル（パスワード保護など）のページを、
   * 表示に使っている pdf.js で画像へ起こす。書き出しの最後の手段。
   */
  const rasterizePage = useCallback(
    async (sourceId: string, sourceIndex: number, rotation: number) => {
      const source = sources.find((item) => item.id === sourceId);
      if (!source) throw new Error("source not found");

      const page = await source.doc.getPage(sourceIndex + 1);
      // 2倍で描いて、PDF 側では等倍に置く。印刷に耐える程度の解像度。
      const scale = 2;
      const viewport = page.getViewport({ scale, rotation });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("canvas unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("rasterize failed");

      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: viewport.width / scale,
        height: viewport.height / scale,
      };
    },
    [sources],
  );

  const handleRestore = useCallback(async () => {
    const session = restorable;
    if (!session) return;
    setRestorable(null);

    const restored = await restoreSources(session.sources);
    if (!restored) return;

    for (const image of session.images) {
      images.restore(image);
    }
    textLayersRef.current.clear();
    reset(session.doc);
    setCurrentPage(0);
    setSelectedIds([]);
    setBanner({ message: "前回の編集内容を復元しました。", tone: "info" });
  }, [images, restorable, restoreSources, reset]);

  const handleDiscardRestore = useCallback(() => {
    setRestorable(null);
    void clearSession();
  }, []);

  // --- ページに関する導出値 -----------------------------------------
  const sourceById = useMemo(() => {
    const map = new Map<string, LoadedSource>();
    for (const source of sources) map.set(source.id, source);
    return map;
  }, [sources]);

  const pageCount = doc.pages.length;
  const activePageIndex = Math.min(currentPage, Math.max(0, pageCount - 1));
  const activePage = doc.pages[activePageIndex] ?? null;

  /** 各ページの表示寸法・最終回転角・元ファイル。 */
  const pageViews = useMemo(
    () =>
      doc.pages.map((page) => {
        const source = sourceById.get(page.sourceId);
        if (!source) return null;
        const rotation = normalizeAngle(
          (source.rotations[page.sourceIndex] ?? 0) + page.rotation,
        );
        const size = rotatedPageSize(source.sizes[page.sourceIndex], rotation);
        return { source, rotation, width: size.width, height: size.height };
      }),
    [doc.pages, sourceById],
  );

  const effectiveZoom = useMemo(() => {
    const valid = pageViews.filter((view) => view !== null);
    if (zoomMode === "custom" || valid.length === 0 || !viewport.width) {
      return zoom;
    }
    const widest = Math.max(...valid.map((view) => view.width));
    const tallest = Math.max(...valid.map((view) => view.height));
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

  // 太字が使われたらそのウェイトを取りに行く。
  useEffect(() => {
    if (doc.elements.some((e) => e.type === "text" && e.fontWeight === "bold")) {
      requestWeight("bold");
    }
  }, [doc.elements, requestWeight]);

  // --- 要素の更新 ---------------------------------------------------
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
          elements.map((element) => {
            if (!selectedIds.includes(element.id)) return element;
            const next = { ...element, ...patch } as EditorElement;
            // 次に作る要素の既定値へ反映する（最後に使った色や太さを覚える）。
            setStyle((current) => deriveStyle(current, next));
            return next;
          }),
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
      (elements) =>
        elements.filter(
          (element) => !selectedIds.includes(element.id) || element.locked,
        ),
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

  // --- 重なり順 -----------------------------------------------------
  const reorderSelected = useCallback(
    (direction: "front" | "back" | "forward" | "backward") => {
      if (selectedIds.length === 0) return;
      updateElements((elements) => {
        const picked = elements.filter((e) => selectedIds.includes(e.id));
        const rest = elements.filter((e) => !selectedIds.includes(e.id));

        if (direction === "front") return [...rest, ...picked];
        if (direction === "back") return [...picked, ...rest];

        // 1 段ずつの移動。選択の塊をまとめて隣と入れ替える。
        const next = [...elements];
        const indexes = next
          .map((element, index) => ({ element, index }))
          .filter(({ element }) => selectedIds.includes(element.id))
          .map(({ index }) => index);
        if (indexes.length === 0) return elements;

        if (direction === "forward") {
          for (let i = indexes.length - 1; i >= 0; i -= 1) {
            const from = indexes[i];
            if (from >= next.length - 1) continue;
            [next[from], next[from + 1]] = [next[from + 1], next[from]];
          }
        } else {
          for (const from of indexes) {
            if (from <= 0) continue;
            [next[from], next[from - 1]] = [next[from - 1], next[from]];
          }
        }
        return next;
      }, false);
    },
    [selectedIds, updateElements],
  );

  // --- 整列・等間隔 -------------------------------------------------
  const measureCtxFor = useCallback(
    (pageIndex: number) => {
      const view = pageViews[pageIndex];
      return view ? { view: { width: view.width, height: view.height }, fonts } : null;
    },
    [pageViews, fonts],
  );

  const alignSelected = useCallback(
    (mode: AlignMode) => {
      if (selectedElements.length < 2) return;
      const ctx = measureCtxFor(selectedElements[0].pageIndex);
      if (!ctx) return;

      const rects = selectedElements.map((element) =>
        elementBoundingRect(element, ctx),
      );
      const offsets = alignOffsets(rects, mode);
      const byId = new Map(
        selectedElements.map((element, index) => [element.id, offsets[index]]),
      );

      updateElements(
        (elements) =>
          elements.map((element) => {
            const offset = byId.get(element.id);
            return offset ? translateElement(element, offset.dx, offset.dy) : element;
          }),
        false,
      );
    },
    [measureCtxFor, selectedElements, updateElements],
  );

  const distributeSelected = useCallback(
    (axis: "horizontal" | "vertical") => {
      if (selectedElements.length < 3) return;
      const ctx = measureCtxFor(selectedElements[0].pageIndex);
      if (!ctx) return;

      const rects = selectedElements.map((element) =>
        elementBoundingRect(element, ctx),
      );
      const offsets = distributeOffsets(rects, axis);
      const byId = new Map(
        selectedElements.map((element, index) => [element.id, offsets[index]]),
      );

      updateElements(
        (elements) =>
          elements.map((element) => {
            const offset = byId.get(element.id);
            return offset ? translateElement(element, offset.dx, offset.dy) : element;
          }),
        false,
      );
    },
    [measureCtxFor, selectedElements, updateElements],
  );

  // --- グループ・ロック ---------------------------------------------
  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    const groupId = createId("group");
    updateElements(
      (elements) =>
        elements.map((element) =>
          selectedIds.includes(element.id) ? { ...element, groupId } : element,
        ),
      false,
    );
  }, [selectedIds, updateElements]);

  const ungroupSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    updateElements(
      (elements) =>
        elements.map((element) =>
          selectedIds.includes(element.id) ? { ...element, groupId: null } : element,
        ),
      false,
    );
  }, [selectedIds, updateElements]);

  const toggleLock = useCallback(() => {
    if (selectedIds.length === 0) return;
    const shouldLock = !selectedElements.every((element) => element.locked);
    updateElements(
      (elements) =>
        elements.map((element) =>
          selectedIds.includes(element.id)
            ? { ...element, locked: shouldLock }
            : element,
        ),
      false,
    );
  }, [selectedElements, selectedIds, updateElements]);

  // --- スタンプ -----------------------------------------------------
  const handleSaveStamp = useCallback(
    (label: string) => {
      setStampPrompt(false);
      if (selectedElements.length === 0) return;
      const ctx = measureCtxFor(selectedElements[0].pageIndex);
      if (!ctx) return;

      const bounds = unionRect(
        selectedElements.map((element) => elementBoundingRect(element, ctx)),
      );
      if (!bounds) return;

      const stamp = createStamp(label, selectedElements, bounds, ctx.view);
      setStamps(saveStamp(stamp));
      setBanner({ message: `「${label}」を保存しました。`, tone: "info" });
    },
    [measureCtxFor, selectedElements],
  );

  const handlePlaceStamp = useCallback(
    (stamp: SavedStamp) => {
      const view = pageViews[activePageIndex];
      if (!view) return;

      // ページ幅の 30% を基準に、保存時の縦横比を保って置く。
      const width = 0.3;
      const heightPt = (width * view.width) / stamp.aspect;
      const target: NormalizedRect = {
        x: 0.35,
        y: 0.4,
        w: width,
        h: clamp(heightPt / view.height, 0.02, 0.9),
      };

      const created = instantiateStamp(stamp, activePageIndex, target);
      updateElements((elements) => [...elements, ...created], false);
      setSelectedIds(created.map((element) => element.id));
      setTool("select");
    },
    [activePageIndex, pageViews, updateElements],
  );

  const handleDeleteStamp = useCallback((id: string) => {
    setStamps(deleteStamp(id));
  }, []);

  // --- テキスト編集 -------------------------------------------------
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

  // --- 既存テキストの扱い（ハイライト吸着・書き換え） ------------------
  const textLayerFor = useCallback(
    (pageIndex: number) => {
      const view = pageViews[pageIndex];
      const page = doc.pages[pageIndex];
      if (!view || !page) return null;

      let cache = textLayersRef.current.get(page.sourceId);
      if (!cache) {
        cache = new TextLayerCache(view.source.doc);
        textLayersRef.current.set(page.sourceId, cache);
      }
      return cache.get(page.sourceIndex, view.rotation);
    },
    [doc.pages, pageViews],
  );

  /** ハイライトを描き終えたら、下にある文字の行に合わせて整える。 */
  const handleDrawComplete = useCallback(
    async (element: EditorElement) => {
      if (element.type !== "highlight") return;

      const pageText = await textLayerFor(element.pageIndex);
      if (!pageText) return;

      const lines = selectLines(pageText, {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
      });
      if (lines.length === 0) return;

      // 行ごとの帯に置き換える。少しだけ上下に余裕を持たせる。
      const padding = 0.002;
      const replacements = lines.map((rect, index) => ({
        ...element,
        id: index === 0 ? element.id : createId("highlight"),
        x: rect.x,
        y: rect.y - padding,
        w: rect.w,
        h: rect.h + padding * 2,
      }));

      updateElements(
        (elements) =>
          elements.flatMap((item) =>
            item.id === element.id ? replacements : [item],
          ),
        false,
      );
      setSelectedIds(replacements.map((item) => item.id));
    },
    [textLayerFor, updateElements],
  );

  /** なぞった既存テキストを、白く覆って打ち直せる状態にする。 */
  const handleTextEditRequest = useCallback(
    async (pageIndex: number, rect: NormalizedRect) => {
      const pageText = await textLayerFor(pageIndex);
      const view = pageViews[pageIndex];
      if (!pageText || !view) return;

      const lines = selectLines(pageText, rect);
      if (lines.length === 0) {
        setBanner({
          message: "その範囲には文字が見つかりませんでした。スキャンされたPDFの可能性があります。",
          tone: "error",
        });
        return;
      }

      const bounds = unionRect(lines);
      if (!bounds) return;

      const text = selectedText(pageText, rect);
      // 覆う範囲は行の外接矩形より少し広げる。
      const padding = 0.003;
      const cover: NormalizedRect = {
        x: bounds.x - padding,
        y: bounds.y - padding,
        w: bounds.w + padding * 2,
        h: bounds.h + padding * 2,
      };

      const whiteout = createWhiteoutElement(pageIndex, cover, "#ffffff");
      // 元の文字の高さからフォントサイズを見積もる。
      const fontSize = clamp(
        (lines[0].h * view.height) / 1.32,
        8,
        200,
      );
      const replacement = createTextElement(
        pageIndex,
        bounds.x,
        bounds.y,
        { ...style, fontSize },
        { text, fontSize },
      );

      updateElements(
        (elements) => [...elements, whiteout, replacement],
        false,
      );
      setSelectedIds([replacement.id]);
      setTool("select");
      setEditingId(replacement.id);
      history.beginTransaction();
    },
    [history, pageViews, style, textLayerFor, updateElements],
  );

  // --- 画像の挿入 ---------------------------------------------------
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

  // --- ページ操作 ---------------------------------------------------
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
      textLayersRef.current.clear();
    },
    [commit],
  );

  const deletePage = useCallback(
    (index: number) => {
      if (pageCount <= 1) return;
      commit((current) => ({
        pages: current.pages.filter((_, i) => i !== index),
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

        const elements = current.elements.map((element) => {
          if (element.pageIndex === index) return { ...element, pageIndex: target };
          if (element.pageIndex === target) return { ...element, pageIndex: index };
          return element;
        });

        return { pages, elements };
      });
      setCurrentPage(target);
    },
    [commit, pageCount],
  );

  const reorderPages = useCallback(
    (from: number, to: number) => {
      if (from === to || to < 0 || to >= pageCount) return;

      commit((current) => {
        const pages = [...current.pages];
        const [moved] = pages.splice(from, 1);
        pages.splice(to, 0, moved);

        // ページ番号の付け替え表を作ってから要素を移す。
        const mapping = new Map<number, number>();
        const order = current.pages.map((_, index) => index);
        const [movedIndex] = order.splice(from, 1);
        order.splice(to, 0, movedIndex);
        order.forEach((original, next) => mapping.set(original, next));

        const elements = current.elements.map((element) => ({
          ...element,
          pageIndex: mapping.get(element.pageIndex) ?? element.pageIndex,
        }));

        return { pages, elements };
      });
      setCurrentPage(to);
    },
    [commit, pageCount],
  );

  // --- 書き出し -----------------------------------------------------
  const isExportingRef = useRef(false);

  const runExport = useCallback(
    async (pageIndexes?: number[]) => {
      if (!hasDocument || isExportingRef.current) return;

      isExportingRef.current = true;
      setIsExporting(true);
      setBanner(null);

      try {
        const result = await exportPdf({
          sources: sources.map((source) => ({
            id: source.id,
            bytes: source.bytes,
            fileName: source.fileName,
          })),
          doc,
          images,
          baseFileName: sources[0]?.fileName,
          mode: exportMode,
          pageIndexes,
          rasterizePage,
        });
        downloadBlob(result.blob, result.fileName);

        const notes = [];
        if (result.usedRasterFallback) {
          notes.push(
            "保護されたPDFのため、ページを画像として取り込みました（文字は選択できません）",
          );
        }
        if (result.usedFullFontEmbed) {
          notes.push("フォントを全体埋め込みしたためサイズが大きくなっています");
        }
        setBanner({
          message:
            `${result.fileName} を書き出しました。` +
            (notes.length > 0 ? `（${notes.join("・")}）` : ""),
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
    },
    [doc, exportMode, hasDocument, images, rasterizePage, sources],
  );

  const handleExport = useCallback(() => void runExport(), [runExport]);
  const handleExtractPage = useCallback(
    () => void runExport([activePageIndex]),
    [activePageIndex, runExport],
  );

  // --- 検索 ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    // 検索していないときの後始末も含め、すべて非同期の中で行う。
    if (!searchOpen || searchQuery.trim().length === 0) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setSearchMatches([]);
        setSearchIndex(0);
        setIsSearching(false);
      });
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      setIsSearching(true);
      const found: SearchMatch[] = [];
      for (let index = 0; index < doc.pages.length; index += 1) {
        if (cancelled) return;
        const pageText = await textLayerFor(index);
        if (!pageText) continue;
        found.push(...findInPage(pageText, searchQuery.trim(), index));
      }
      if (cancelled) return;
      setSearchMatches(found);
      setSearchIndex(0);
      setIsSearching(false);
      if (found.length > 0) scrollToPageRef.current?.(found[0].pageIndex);
    })();

    return () => {
      cancelled = true;
    };
  }, [doc.pages.length, searchOpen, searchQuery, textLayerFor]);

  const goToMatch = useCallback(
    (delta: number) => {
      if (searchMatches.length === 0) return;
      const next =
        (searchIndex + delta + searchMatches.length) % searchMatches.length;
      setSearchIndex(next);
      scrollToPageRef.current?.(searchMatches[next].pageIndex);
    },
    [searchIndex, searchMatches],
  );

  const searchRectsByPage = useMemo(() => {
    const map = new Map<number, NormalizedRect[]>();
    searchMatches.forEach((match) => {
      const list = map.get(match.pageIndex) ?? [];
      list.push(...match.rects);
      map.set(match.pageIndex, list);
    });
    return map;
  }, [searchMatches]);

  const activeMatch = searchMatches[searchIndex] ?? null;

  // --- ページ移動 ---------------------------------------------------
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

  // --- キーボード ---------------------------------------------------
  const { undo, redo } = history;
  useEffect(() => {
    if (!hasDocument) return;

    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "s") {
        // ブラウザの保存ダイアログではなく PDF 書き出しを出す。
        event.preventDefault();
        handleExport();
        return;
      }

      if (isTextEntry) return;

      if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(
          (elementsByPage.get(activePageIndex) ?? [])
            .filter((element) => !element.locked)
            .map((element) => element.id),
        );
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (modifier && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected();
        else groupSelected();
        return;
      }
      if (modifier && event.key === "]") {
        event.preventDefault();
        reorderSelected(event.shiftKey ? "front" : "forward");
        return;
      }
      if (modifier && event.key === "[") {
        event.preventDefault();
        reorderSelected(event.shiftKey ? "back" : "backward");
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
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        setSelectedIds([]);
        stopEditing();
        setTool("select");
        return;
      }

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
              selectedIds.includes(element.id) && !element.locked
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
    hasDocument,
    redo,
    undo,
    history,
    selectedIds,
    selectedElements,
    activePageIndex,
    elementsByPage,
    deleteSelected,
    duplicateSelected,
    groupSelected,
    ungroupSelected,
    reorderSelected,
    stopEditing,
    updateElements,
    handleExport,
    searchOpen,
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
      getElements: () => history.getState().elements,
      startEditing,
      requestImage,
      onDrawComplete: (element) => void handleDrawComplete(element),
      onTextEditRequest: (pageIndex, rect) =>
        void handleTextEditRequest(pageIndex, rect),
    }),
    [
      history,
      updateElements,
      addElement,
      removeElement,
      startEditing,
      requestImage,
      handleDrawComplete,
      handleTextEditRequest,
    ],
  );

  // --- 描画 ----------------------------------------------------------
  const headerProps = {
    onOpenFile: handleOpenFile,
    onMergeFile: (file: File) => void handleMergeFile(file),
    onExport: handleExport,
    exportMode,
    onExportModeChange: setExportMode,
    onToggleSearch: () => setSearchOpen((value) => !value),
    saveState,
    showPagePanel,
    onTogglePagePanel: () => setShowPagePanel((value) => !value),
    onUndo: undo,
    onRedo: redo,
    zoomMode,
    onZoomChange: handleZoomChange,
    onZoomModeChange: setZoomMode,
    onPageChange: goToPage,
  };

  if (!hasDocument) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader
          {...headerProps}
          fileName={null}
          isExporting={false}
          canExport={false}
          canUndo={false}
          canRedo={false}
          zoom={zoom}
          pageIndex={0}
          pageCount={1}
        />
        <DropZone
          onFile={handleOpenFile}
          isLoading={isLoading}
          error={loadError}
          onDismissError={clearError}
        />
        {passwordPrompt && (
          <PasswordDialog
            fileName={passwordPrompt.fileName}
            wasWrong={passwordPrompt.wasWrong}
            onSubmit={(password) =>
              void handleOpenFile(passwordPrompt.file, password)
            }
            onCancel={cancelPassword}
          />
        )}
        {restorable && (
          <RestoreDialog
            description={describeSession(restorable)}
            onRestore={() => void handleRestore()}
            onDiscard={handleDiscardRestore}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader
        {...headerProps}
        fileName={sources.map((source) => source.fileName).join(" + ")}
        isExporting={isExporting}
        canExport
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        zoom={effectiveZoom}
        pageIndex={activePageIndex}
        pageCount={pageCount}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail tool={tool} onSelect={setTool} />

        {showPagePanel && (
          <PageRail
            pages={doc.pages}
            pageViews={pageViews}
            currentPage={activePageIndex}
            onSelectPage={goToPage}
            onRotatePage={rotatePage}
            onDeletePage={deletePage}
            onDuplicatePage={duplicatePage}
            onMovePage={movePage}
            onReorderPages={reorderPages}
            elementCounts={elementCounts}
          />
        )}

        <div className="relative flex min-w-0 flex-1">
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
                  key={`${page.sourceId}-${page.sourceIndex}-${index}`}
                  doc={view.source.doc}
                  pageIndex={index}
                  sourceIndex={page.sourceIndex}
                  rotation={view.rotation}
                  view={{ width: view.width, height: view.height }}
                  zoom={effectiveZoom}
                  elements={elementsByPage.get(index) ?? []}
                  selectedIds={selectedIds}
                  editingId={editingId}
                  tool={tool}
                  style={style}
                  fonts={fonts}
                  images={images}
                  actions={actions}
                  snapEnabled={snapEnabled}
                  searchRects={searchRectsByPage.get(index) ?? []}
                  activeSearchRects={
                    activeMatch?.pageIndex === index ? activeMatch.rects : []
                  }
                  onPreviewText={previewText}
                  onFinishEdit={finishEdit}
                  onRenderError={handleRenderError}
                />
              );
            })}
          </DocumentView>

          {searchOpen && (
            <SearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              matchCount={searchMatches.length}
              activeIndex={searchIndex}
              isSearching={isSearching}
              onNext={() => goToMatch(1)}
              onPrevious={() => goToMatch(-1)}
              onClose={() => setSearchOpen(false)}
            />
          )}
        </div>

        <Inspector
          selected={selectedElements}
          page={activePage}
          pageIndex={activePageIndex}
          pageCount={pageCount}
          stamps={stamps}
          onPreview={(patch) => patchSelected(patch, true)}
          onCommit={(patch) => patchSelected(patch, false)}
          onBeginTransaction={history.beginTransaction}
          onEndTransaction={history.endTransaction}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onReorder={reorderSelected}
          onAlign={alignSelected}
          onDistribute={distributeSelected}
          onGroup={groupSelected}
          onUngroup={ungroupSelected}
          onToggleLock={toggleLock}
          onSaveStamp={() => setStampPrompt(true)}
          onPlaceStamp={handlePlaceStamp}
          onDeleteStamp={handleDeleteStamp}
          onRotatePage={() => rotatePage(activePageIndex)}
          onDeletePage={() => deletePage(activePageIndex)}
          onExtractPage={handleExtractPage}
        />
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        aria-label="貼り付ける画像"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          event.target.value = "";
          if (file) void handleImageSelected(file);
        }}
      />

      {passwordPrompt && (
        <PasswordDialog
          fileName={passwordPrompt.fileName}
          wasWrong={passwordPrompt.wasWrong}
          onSubmit={(password) => {
            // 結合として開こうとしていたなら、結合の経路で開き直す。
            if (passwordPrompt.append) {
              void handleMergeFile(passwordPrompt.file, password);
            } else {
              void handleOpenFile(passwordPrompt.file, password);
            }
          }}
          onCancel={cancelPassword}
        />
      )}

      {stampPrompt && (
        <PromptDialog
          title="スタンプの名前"
          defaultValue="新しいスタンプ"
          onSubmit={handleSaveStamp}
          onCancel={() => setStampPrompt(false)}
        />
      )}

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
