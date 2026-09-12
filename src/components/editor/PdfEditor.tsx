"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import type { ZoomMode } from "./AppHeader";
import {
  OcrDialog,
  PasswordDialog,
  PromptDialog,
  RestoreDialog,
  SignatureDialog,
} from "./Dialogs";
import { DocumentView } from "./DocumentView";
import { DropZone } from "./DropZone";
import { CommentsPanel } from "./CommentsPanel";
import { FormPanel } from "./FormPanel";
import { Inspector } from "./Inspector";
import { LayersPanel } from "./LayersPanel";
import { SidePanel } from "./SidePanel";
import type { PanelTab } from "./SidePanel";
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
import { downloadBlob, printBlob } from "@/lib/pdf/exportPdf";
import type { ExportMode, RasterPage } from "@/lib/pdf/exportPdf";
import { runExport, toBlob } from "@/lib/pdf/exportRunner";
import { readFormFields } from "@/lib/pdf/forms";
import type { FormField } from "@/lib/pdf/forms";
import { disposeOcr, recognizePage } from "@/lib/pdf/ocr";
import type { OcrLanguage, OcrProgress } from "@/lib/pdf/ocr";
import {
  createSelfSignedCredential,
  injectSignature,
  prepareSignature,
  readPkcs12,
} from "@/lib/pdf/signature";
import type { SigningCredential } from "@/lib/pdf/signature";
import type { Unit } from "@/lib/pdf/units";
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
import type { PageText, SearchMatch } from "@/lib/pdf/textLayer";
import {
  describeSession,
  listSessions,
  loadSession,
} from "@/lib/pdf/persistence";
import type { SessionSummary, StoredSession } from "@/lib/pdf/persistence";
import { PDFDocument } from "pdf-lib";
import {
  createStamp,
  deleteStamp,
  instantiateStamp,
  loadStamps,
  saveStamp,
} from "@/lib/pdf/stamps";
import type { SavedStamp } from "@/lib/pdf/stamps";
import { isBlankPage } from "@/types/editor";
import type {
  EditorDoc,
  EditorElement,
  NormalizedRect,
  PageSize,
  RotationDelta,
  ToolId,
} from "@/types/editor";

const EMPTY_DOC: EditorDoc = { pages: [], elements: [] };

/**
 * 要素の座標をまとめて拡大縮小する（切り抜きで版面が変わったとき用）。
 * 大きさそのもの（フォントサイズや線幅）は変えない。
 */
function scaleElement(
  element: EditorElement,
  scaleX: number,
  scaleY: number,
): EditorElement {
  if (element.type === "arrow") {
    return {
      ...element,
      x1: element.x1 * scaleX,
      y1: element.y1 * scaleY,
      x2: element.x2 * scaleX,
      y2: element.y2 * scaleY,
    };
  }
  if (element.type === "pen") {
    return {
      ...element,
      points: element.points.map((point) => ({
        ...point,
        x: point.x * scaleX,
        y: point.y * scaleY,
      })),
    };
  }
  if (element.type === "text") {
    return { ...element, x: element.x * scaleX, y: element.y * scaleY };
  }
  if (element.type === "callout") {
    return {
      ...element,
      x: element.x * scaleX,
      y: element.y * scaleY,
      w: element.w * scaleX,
      h: element.h * scaleY,
      targetX: element.targetX * scaleX,
      targetY: element.targetY * scaleY,
    };
  }
  return {
    ...element,
    x: element.x * scaleX,
    y: element.y * scaleY,
    w: element.w * scaleX,
    h: element.h * scaleY,
  };
}
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
  c: "callout",
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
  const [panelTab, setPanelTab] = useState<PanelTab>("properties");
  const [unit, setUnit] = useState<Unit>("percent");
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [authorName, setAuthorName] = useState("");

  // フォーム
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [flattenForm, setFlattenForm] = useState(false);

  // OCR
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrWorking, setOcrWorking] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);

  // 電子署名
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signing, setSigning] = useState(false);

  // 最近開いた文書
  const [recentDocuments, setRecentDocuments] = useState<SessionSummary[]>([]);
  // 画面が狭いときはパネルを畳む
  const [narrow, setNarrow] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
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
  // OCR で読み取った結果。元PDFの文字情報より優先する。
  const ocrResultsRef = useRef(new Map<string, PageText>());

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
    formValues,
  });

  // 画面の広さでパネルの出し方を変える。
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1279px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // 最近開いた文書の一覧。
  useEffect(() => {
    if (!hasDocument) return;
    listSessions().then(setRecentDocuments, () => undefined);
  }, [hasDocument, saveState]);

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
      setPanelTab("properties");

      // 入力欄を持つPDFなら、フォームのタブを使えるようにする。
      readFormFields(loaded.bytes).then(
        (fields) => {
          setFormFields(fields);
          setFormValues(
            Object.fromEntries(fields.map((field) => [field.name, field.value])),
          );
        },
        () => setFormFields([]),
      );
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

  /** 自動保存から復帰する。 */
  const handleRestore = useCallback(async () => {
    const session = restorable;
    if (!session) return;
    setRestorable(null);

    const restored = await restoreSources(session.sources);
    if (!restored) return;

    for (const image of session.images) images.restore(image);
    textLayersRef.current.clear();
    ocrResultsRef.current.clear();
    reset(session.doc);
    setFormValues(session.formValues ?? {});
    setCurrentPage(0);
    setSelectedIds([]);
    setBanner({ message: "前回の編集内容を復元しました。", tone: "info" });
  }, [images, restorable, restoreSources, reset]);

  /** 一覧から選んだ文書を開き直す。 */
  const handleOpenRecent = useCallback(
    async (id: string) => {
      const session = await loadSession(id);
      if (!session) return;

      const restored = await restoreSources(session.sources);
      if (!restored) return;

      for (const image of session.images) images.restore(image);
      textLayersRef.current.clear();
      ocrResultsRef.current.clear();
      reset(session.doc);
      setFormValues(session.formValues ?? {});
      setCurrentPage(0);
      setSelectedIds([]);
      setBanner({
        message: `${session.sources.map((s2) => s2.fileName).join("、")} を開きました。`,
        tone: "info",
      });
    },
    [images, restoreSources, reset],
  );

  /**
   * 復帰しないことを選んだ場合。
   * 保存自体は消さない。「最近の文書」からいつでも開き直せる。
   */
  const handleDiscardRestore = useCallback(() => {
    setRestorable(null);
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
        // 白紙ページは元ファイルを持たない。
        if (isBlankPage(page)) {
          const size = page.blankSize ?? { width: 595.28, height: 841.89 };
          const rotation = normalizeAngle(page.rotation);
          const rotated = rotatedPageSize(size, rotation);
          return {
            source: null,
            rotation,
            width: rotated.width,
            height: rotated.height,
            crop: undefined,
            fullSize: rotated,
          };
        }

        const source = sourceById.get(page.sourceId);
        if (!source) return null;
        const rotation = normalizeAngle(
          (source.rotations[page.sourceIndex] ?? 0) + page.rotation,
        );
        const size = rotatedPageSize(source.sizes[page.sourceIndex], rotation);
        // 切り抜きが入っていると、版面はその範囲だけになる。
        const crop = page.crop;
        return {
          source,
          rotation,
          width: crop ? size.width * crop.w : size.width,
          height: crop ? size.height * crop.h : size.height,
          crop,
          fullSize: size,
        };
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
  /** 使った色を「最近の色」へ積む。 */
  const rememberColor = useCallback((patch: Partial<EditorElement>) => {
    const used = [
      "color" in patch ? patch.color : null,
      "fill" in patch ? patch.fill : null,
      "stroke" in patch ? patch.stroke : null,
    ].filter((value): value is string => typeof value === "string");
    if (used.length === 0) return;

    setRecentColors((previous) => {
      const next = [...used, ...previous.filter((c) => !used.includes(c))];
      return next.slice(0, 8);
    });
  }, []);

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
            rememberColor(patch);
            return next;
          }),
        transient,
      );
    },
    [rememberColor, selectedIds, updateElements],
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

  /** レイヤー一覧からの表示切り替え。 */
  const toggleVisible = useCallback(
    (id: string) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id
              ? { ...element, visible: !element.visible }
              : element,
          ),
        false,
      );
    },
    [updateElements],
  );

  /** レイヤー一覧からのロック切り替え。 */
  const toggleLockOne = useCallback(
    (id: string) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id ? { ...element, locked: !element.locked } : element,
          ),
        false,
      );
    },
    [updateElements],
  );

  /** レイヤー一覧の並べ替え（ページ内の重なり順）。 */
  const reorderWithinPage = useCallback(
    (from: number, to: number) => {
      updateElements((elements) => {
        const onPage = elements.filter(
          (element) => element.pageIndex === activePageIndex,
        );
        if (from === to || !onPage[from] || !onPage[to]) return elements;

        const reordered = [...onPage];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);

        // ページ内の並びだけ差し替え、他のページはそのまま。
        let cursor = 0;
        return elements.map((element) =>
          element.pageIndex === activePageIndex ? reordered[cursor++] : element,
        );
      }, false);
    },
    [activePageIndex, updateElements],
  );

  // --- コメント -----------------------------------------------------
  const addComment = useCallback(
    (id: string, text: string) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id
              ? {
                  ...element,
                  comment: {
                    author: authorName || "名無し",
                    text,
                    createdAt: Date.now(),
                    replies: [],
                    resolved: false,
                  },
                }
              : element,
          ),
        false,
      );
    },
    [authorName, updateElements],
  );

  const addReply = useCallback(
    (id: string, text: string) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id && element.comment
              ? {
                  ...element,
                  comment: {
                    ...element.comment,
                    replies: [
                      ...element.comment.replies,
                      {
                        id: createId("reply"),
                        author: authorName || "名無し",
                        text,
                        createdAt: Date.now(),
                      },
                    ],
                  },
                }
              : element,
          ),
        false,
      );
    },
    [authorName, updateElements],
  );

  const toggleResolved = useCallback(
    (id: string) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id && element.comment
              ? {
                  ...element,
                  comment: {
                    ...element.comment,
                    resolved: !element.comment.resolved,
                  },
                }
              : element,
          ),
        false,
      );
    },
    [updateElements],
  );

  const deleteComment = useCallback(
    (id: string) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id ? { ...element, comment: undefined } : element,
          ),
        false,
      );
    },
    [updateElements],
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

      if (!view.source) return null;

      // OCR で読み取った結果があればそれを使う。
      const ocrKey = `${page.sourceId}:${page.sourceIndex}`;
      const recognized = ocrResultsRef.current.get(ocrKey);
      if (recognized) return recognized;

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

  /**
   * 覆いたい範囲のすぐ外側から下地の色を拾う。
   * 白い紙とは限らないので、決め打ちの白より馴染む。
   */
  const sampleBackgroundColor = useCallback(
    (pageIndex: number, area: NormalizedRect): string => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        `[data-page-index="${pageIndex}"] canvas`,
      );
      if (!canvas || canvas.width === 0) return "#ffffff";

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return "#ffffff";

      // 範囲の少し外側を数点サンプリングし、最も明るい色を下地とみなす。
      const margin = 0.006;
      const points = [
        { x: area.x + area.w / 2, y: area.y - margin },
        { x: area.x + area.w / 2, y: area.y + area.h + margin },
        { x: area.x - margin, y: area.y + area.h / 2 },
        { x: area.x + area.w + margin, y: area.y + area.h / 2 },
      ];

      let best: [number, number, number] | null = null;
      for (const point of points) {
        const px = Math.round(point.x * canvas.width);
        const py = Math.round(point.y * canvas.height);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;

        try {
          const [r, g, b] = context.getImageData(px, py, 1, 1).data;
          if (!best || r + g + b > best[0] + best[1] + best[2]) best = [r, g, b];
        } catch {
          // 別ドメインの内容は読めないが、ここでは自前で描いた canvas なので通常通る。
        }
      }

      if (!best) return "#ffffff";
      return `#${best.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    },
    [],
  );

  /** なぞった既存テキストを、下地の色で覆って打ち直せる状態にする。 */
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

      // 覆う色は、そのページの下地から拾う。白紙とは限らないため。
      const backdrop = sampleBackgroundColor(pageIndex, cover);
      const whiteout = createWhiteoutElement(pageIndex, cover, backdrop);
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
    [history, pageViews, sampleBackgroundColor, style, textLayerFor, updateElements],
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

  /** 表示中のページの後ろに白紙を差し込む。 */
  const insertBlankPage = useCallback(
    (index: number) => {
      const view = pageViews[index];
      const size: PageSize = view
        ? { width: view.width, height: view.height }
        : { width: 595.28, height: 841.89 };

      commit((current) => {
        const pages = [...current.pages];
        pages.splice(index + 1, 0, {
          sourceId: "",
          sourceIndex: -1,
          rotation: 0,
          blankSize: size,
        });
        return {
          pages,
          elements: current.elements.map((element) =>
            element.pageIndex > index
              ? { ...element, pageIndex: element.pageIndex + 1 }
              : element,
          ),
        };
      });
      setCurrentPage(index + 1);
    },
    [commit, pageViews],
  );

  /**
   * 選択中の要素の範囲でページを切り抜く。
   * 版面が変わるので、載っている要素の座標も新しい版面へ写し直す。
   */
  const cropPage = useCallback(
    (index: number) => {
      const view = pageViews[index];
      if (!view) return;

      const ctx = { view: { width: view.width, height: view.height }, fonts };
      const area = unionRect(
        selectedElements
          .filter((element) => element.pageIndex === index)
          .map((element) => elementBoundingRect(element, ctx)),
      );
      if (!area || area.w < 0.02 || area.h < 0.02) {
        setBanner({
          message:
            "切り抜く範囲を決めるため、目印になる要素を選んでから実行してください。",
          tone: "error",
        });
        return;
      }

      commit((current) => ({
        pages: current.pages.map((page, i) =>
          i === index ? { ...page, crop: area } : page,
        ),
        // 新しい版面を基準に座標を取り直す。
        elements: current.elements.map((element) => {
          if (element.pageIndex !== index) return element;
          const moved = translateElement(element, -area.x, -area.y);
          return scaleElement(moved, 1 / area.w, 1 / area.h);
        }),
      }));
      setSelectedIds([]);
    },
    [commit, fonts, pageViews, selectedElements],
  );

  const clearCrop = useCallback(
    (index: number) => {
      const previous = doc.pages[index]?.crop;
      if (!previous) return;

      commit((current) => ({
        pages: current.pages.map((page, i) =>
          i === index ? { ...page, crop: undefined } : page,
        ),
        elements: current.elements.map((element) => {
          if (element.pageIndex !== index) return element;
          const scaled = scaleElement(element, previous.w, previous.h);
          return translateElement(scaled, previous.x, previous.y);
        }),
      }));
    },
    [commit, doc.pages],
  );

  const resizePage = useCallback(
    (index: number, size: PageSize | null) => {
      commit((current) => ({
        ...current,
        pages: current.pages.map((page, i) =>
          i === index ? { ...page, resizeTo: size ?? undefined } : page,
        ),
      }));
    },
    [commit],
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

  /**
   * pdf-lib が読めないファイル（パスワード保護など）のページを、
   * 表示に使っている pdf.js で画像へ起こす。書き出しの最後の手段。
   */
  const rasterizeProtectedPages = useCallback(async (): Promise<RasterPage[]> => {
    const rasters: RasterPage[] = [];
    const done = new Set<string>();

    for (const page of doc.pages) {
      if (isBlankPage(page)) continue;
      const source = sourceById.get(page.sourceId);
      if (!source?.encrypted) continue;

      const key = `${page.sourceId}:${page.sourceIndex}`;
      if (done.has(key)) continue;
      done.add(key);

      const pdfPage = await source.doc.getPage(page.sourceIndex + 1);
      const scale = 2;
      const rotation = normalizeAngle(
        (source.rotations[page.sourceIndex] ?? 0) + page.rotation,
      );
      const viewport = pdfPage.getViewport({ scale, rotation });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) continue;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvas, viewport, background: "#ffffff" }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) continue;

      rasters.push({
        key,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: viewport.width / scale,
        height: viewport.height / scale,
      });
    }

    return rasters;
  }, [doc.pages, sourceById]);

  /** 書き出しに必要な素材を集める。 */
  const buildExportOptions = useCallback(
    async (pageIndexes?: number[]) => {
      const usedImages = new Map<string, { id: string; bytes: Uint8Array; format: "png" | "jpg" }>();
      for (const element of doc.elements) {
        if (element.type !== "image" || usedImages.has(element.assetId)) continue;
        const asset = images.get(element.assetId);
        if (asset) {
          usedImages.set(asset.id, {
            id: asset.id,
            bytes: asset.bytes,
            format: asset.format,
          });
        }
      }

      return {
        sources: sources.map((source) => ({
          id: source.id,
          bytes: source.bytes,
          fileName: source.fileName,
        })),
        doc,
        images: [...usedImages.values()],
        baseFileName: sources[0]?.fileName,
        mode: exportMode,
        pageIndexes,
        rasters: await rasterizeProtectedPages(),
        formValues,
        flattenForm,
      };
    },
    [
      doc,
      exportMode,
      flattenForm,
      formValues,
      images,
      rasterizeProtectedPages,
      sources,
    ],
  );

  const runExportFlow = useCallback(
    async (
      pageIndexes?: number[],
      after: (blob: Blob, fileName: string) => void = downloadBlob,
    ) => {
      if (!hasDocument || isExportingRef.current) return;

      isExportingRef.current = true;
      setIsExporting(true);
      setBanner(null);

      try {
        const options = await buildExportOptions(pageIndexes);
        const result = await runExport(options);
        after(toBlob(result.bytes), result.fileName);

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
    [buildExportOptions, hasDocument],
  );

  const handleExport = useCallback(() => void runExportFlow(), [runExportFlow]);
  const handleExtractPage = useCallback(
    () => void runExportFlow([activePageIndex]),
    [activePageIndex, runExportFlow],
  );
  const handlePrint = useCallback(
    () => void runExportFlow(undefined, (blob) => printBlob(blob)),
    [runExportFlow],
  );

  // --- 文字認識 (OCR) -------------------------------------------------
  /** ページを画像として描き、OCR にかける。 */
  const runOcrOnPage = useCallback(
    async (pageIndex: number, language: OcrLanguage) => {
      const view = pageViews[pageIndex];
      const page = doc.pages[pageIndex];
      if (!view?.source || !page) return;

      const pdfPage = await view.source.doc.getPage(page.sourceIndex + 1);
      // 認識精度は解像度に効く。300dpi 相当まで上げる。
      const viewport = pdfPage.getViewport({
        scale: 300 / 72,
        rotation: view.rotation,
      });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvas, viewport, background: "#ffffff" }).promise;

      const recognized = await recognizePage(canvas, language, setOcrProgress);
      ocrResultsRef.current.set(
        `${page.sourceId}:${page.sourceIndex}`,
        recognized,
      );
    },
    [doc.pages, pageViews],
  );

  const handleRunOcr = useCallback(
    async ({ scope, language }: { scope: "page" | "all"; language: string }) => {
      setOcrWorking(true);
      setOcrProgress({ ratio: 0, label: "準備中…" });

      try {
        const targets =
          scope === "all"
            ? doc.pages.map((_, index) => index)
            : [activePageIndex];

        for (const [order, index] of targets.entries()) {
          setOcrProgress({
            ratio: order / targets.length,
            label: `${index + 1}ページ目を認識中…`,
          });
          await runOcrOnPage(index, language as OcrLanguage);
        }

        setOcrProgress(null);
        setOcrOpen(false);
        setBanner({
          message: `${targets.length}ページの文字を読み取りました。検索・ハイライトの行吸着・既存テキストの書き換えが使えます。`,
          tone: "info",
        });
      } catch (error) {
        setOcrProgress(null);
        setBanner({
          message: toUserMessage(error, "文字の認識に失敗しました。"),
          tone: "error",
        });
      } finally {
        setOcrWorking(false);
      }
    },
    [activePageIndex, doc.pages, runOcrOnPage],
  );

  // 別の文書へ移ったら認識器を片付ける。
  useEffect(() => {
    return () => {
      void disposeOcr();
    };
  }, []);

  // --- 電子署名 -------------------------------------------------------
  const handleSign = useCallback(
    async (options: {
      mode: "self" | "p12";
      name: string;
      reason: string;
      file: File | null;
      password: string;
    }) => {
      setSigning(true);
      setBanner(null);

      try {
        let credential: SigningCredential;
        if (options.mode === "p12") {
          if (!options.file) throw new Error("証明書が選ばれていません");
          credential = await readPkcs12(
            new Uint8Array(await options.file.arrayBuffer()),
            options.password,
          );
        } else {
          credential = await createSelfSignedCredential(
            options.name || "署名者",
          );
        }

        // まず通常どおり編集内容を焼き込んだ PDF を作る。
        const exportOptions = await buildExportOptions();
        const exported = await runExport(exportOptions);

        // その PDF へ署名欄を足し、保存し直してから署名値を差し込む。
        const pdfDoc = await PDFDocument.load(exported.bytes.slice());
        const lastPage = pdfDoc.getPages()[activePageIndex] ?? pdfDoc.getPages()[0];
        const size = lastPage.getSize();

        prepareSignature(
          pdfDoc,
          {
            credential,
            pageIndex: Math.min(activePageIndex, pdfDoc.getPageCount() - 1),
            rect: {
              x: size.width - 220,
              y: 40,
              width: 180,
              height: 56,
            },
            reason: options.reason,
          },
          null,
        );

        // 署名の枠を実バイト列から探すので、オブジェクトストリームは使わない。
        const saved = await pdfDoc.save({ useObjectStreams: false });
        const signed = await injectSignature(saved, credential);

        downloadBlob(toBlob(signed), exported.fileName.replace(/\.pdf$/i, "-signed.pdf"));
        setSignatureOpen(false);
        setBanner({
          message:
            options.mode === "self"
              ? "署名して書き出しました。（自己署名のため、ビューアでは署名者の身元は「不明」と表示されます）"
              : "署名して書き出しました。",
          tone: "info",
        });
      } catch (error) {
        setBanner({
          message: toUserMessage(error, "署名に失敗しました。"),
          tone: "error",
        });
      } finally {
        setSigning(false);
      }
    },
    [activePageIndex, buildExportOptions],
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

      // Tab で要素を順に巡る。ポインタを使わずに選択・編集できる。
      if (event.key === "Tab") {
        const onPage = elementsByPage.get(activePageIndex) ?? [];
        if (onPage.length === 0) return;
        event.preventDefault();

        const current = onPage.findIndex((element) =>
          selectedIds.includes(element.id),
        );
        const step = event.shiftKey ? -1 : 1;
        const next =
          current === -1
            ? event.shiftKey
              ? onPage.length - 1
              : 0
            : (current + step + onPage.length) % onPage.length;
        setSelectedIds([onPage[next].id]);
        return;
      }

      // Enter で選択中のテキストを編集する。
      if (event.key === "Enter" && selectedIds.length === 1) {
        const element = doc.elements.find((item) => item.id === selectedIds[0]);
        if (element && (element.type === "text" || element.type === "callout")) {
          event.preventDefault();
          startEditing(element.id);
          return;
        }
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
    doc.elements,
    startEditing,
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
    onPrint: handlePrint,
    onOpenOcr: () => setOcrOpen(true),
    onOpenSignature: () => setSignatureOpen(true),
    recentDocuments,
    onOpenRecent: (id: string) => void handleOpenRecent(id),
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

      <div className="relative flex min-h-0 flex-1">
        <ToolRail tool={tool} onSelect={setTool} />

        {showPagePanel && !narrow && (
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
                  doc={view.source?.doc ?? null}
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

        {(!narrow || panelOpen) && (
          <SidePanel
            tab={panelTab}
            onTabChange={setPanelTab}
            counts={{
              layers: (elementsByPage.get(activePageIndex) ?? []).length,
              comments: doc.elements.filter((element) => element.comment).length,
              form: formFields.length,
            }}
            floating={narrow}
          >
            {panelTab === "properties" && (
              <Inspector
                selected={selectedElements}
                page={activePage}
                pageIndex={activePageIndex}
                pageCount={pageCount}
                stamps={stamps}
                unit={unit}
                onUnitChange={setUnit}
                pageSize={{
                  width: pageViews[activePageIndex]?.width ?? 595.28,
                  height: pageViews[activePageIndex]?.height ?? 841.89,
                }}
                recentColors={recentColors}
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
                onInsertBlankPage={() => insertBlankPage(activePageIndex)}
                onCropPage={() => cropPage(activePageIndex)}
                onClearCrop={() => clearCrop(activePageIndex)}
                onResizePage={(size) => resizePage(activePageIndex, size)}
              />
            )}

            {panelTab === "layers" && (
              <LayersPanel
                elements={elementsByPage.get(activePageIndex) ?? []}
                selectedIds={selectedIds}
                onSelect={setSelectedIds}
                onToggleVisible={toggleVisible}
                onToggleLock={toggleLockOne}
                onDelete={(id) => {
                  setSelectedIds([id]);
                  updateElements(
                    (elements) => elements.filter((element) => element.id !== id),
                    false,
                  );
                }}
                onReorder={reorderWithinPage}
              />
            )}

            {panelTab === "comments" && (
              <CommentsPanel
                elements={doc.elements}
                selectedIds={selectedIds}
                authorName={authorName}
                onAuthorNameChange={setAuthorName}
                onSelect={(ids, pageIndex) => {
                  setSelectedIds(ids);
                  goToPage(pageIndex);
                }}
                onAddComment={addComment}
                onAddReply={addReply}
                onToggleResolved={toggleResolved}
                onDeleteComment={deleteComment}
              />
            )}

            {panelTab === "form" && (
              <FormPanel
                fields={formFields}
                values={formValues}
                onChange={(name, value) =>
                  setFormValues((previous) => ({ ...previous, [name]: value }))
                }
                flatten={flattenForm}
                onFlattenChange={setFlattenForm}
                onGoToPage={goToPage}
              />
            )}
          </SidePanel>
        )}

        {/* 狭い画面ではパネルを引き出しで開く。 */}
        {narrow && (
          <button
            type="button"
            onClick={() => setPanelOpen((value) => !value)}
            aria-label={panelOpen ? "パネルを閉じる" : "パネルを開く"}
            className="absolute right-2 bottom-2 z-30 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg"
          >
            {panelOpen ? "閉じる" : "プロパティ"}
          </button>
        )}
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

      {ocrOpen && (
        <OcrDialog
          pageCount={pageCount}
          isWorking={ocrWorking}
          progress={ocrProgress}
          onRun={(options) => void handleRunOcr(options)}
          onCancel={() => setOcrOpen(false)}
        />
      )}

      {signatureOpen && (
        <SignatureDialog
          defaultName={authorName || "署名者"}
          isWorking={signing}
          onSign={(options) => void handleSign(options)}
          onCancel={() => setSignatureOpen(false)}
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
