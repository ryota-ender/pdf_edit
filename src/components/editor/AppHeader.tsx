"use client";

import { useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderIcon,
  MergeIcon,
  MinusIcon,
  PanelIcon,
  PlusIcon,
  RedoIcon,
  SearchIcon,
  UndoIcon,
} from "./Icons";
import type { ExportMode } from "@/lib/pdf/exportPdf";

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export type ZoomMode = "custom" | "fit-width" | "fit-page";

interface AppHeaderProps {
  fileName: string | null;
  onOpenFile: (file: File) => void;
  onMergeFile: (file: File) => void;
  onExport: () => void;
  isExporting: boolean;
  canExport: boolean;
  exportMode: ExportMode;
  onExportModeChange: (mode: ExportMode) => void;
  onToggleSearch: () => void;
  /** 自動保存の状態表示。 */
  saveState: "idle" | "saving" | "saved";

  showPagePanel: boolean;
  onTogglePagePanel: () => void;

  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  zoom: number;
  zoomMode: ZoomMode;
  onZoomChange: (zoom: number) => void;
  onZoomModeChange: (mode: ZoomMode) => void;

  pageIndex: number;
  pageCount: number;
  onPageChange: (index: number) => void;
}

/** 画面上部のバー。ファイル操作・履歴・表示倍率・ページ移動をまとめている。 */
export function AppHeader({
  fileName,
  onOpenFile,
  onMergeFile,
  onExport,
  isExporting,
  canExport,
  exportMode,
  onExportModeChange,
  onToggleSearch,
  saveState,
  showPagePanel,
  onTogglePagePanel,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  zoomMode,
  onZoomChange,
  onZoomModeChange,
  pageIndex,
  pageCount,
  onPageChange,
}: AppHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  const stepZoom = (direction: 1 | -1) => {
    const steps = [...ZOOM_STEPS];
    const next =
      direction > 0
        ? steps.find((step) => step > zoom + 0.001)
        : [...steps].reverse().find((step) => step < zoom - 0.001);
    if (next) onZoomChange(next);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
      <div className="flex items-center gap-2 pr-1">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-[10px] font-bold tracking-tight text-white">
          PDF
        </span>
        {fileName ? (
          <span
            className="hidden max-w-52 truncate text-sm font-medium text-slate-800 xl:block"
            title={fileName}
          >
            {fileName}
          </span>
        ) : (
          <span className="hidden text-sm font-semibold text-slate-800 xl:block">
            PDF Editor
          </span>
        )}
      </div>

      {canExport && (
        <>
          <IconButton
            label={showPagePanel ? "ページ一覧を隠す" : "ページ一覧を表示"}
            onClick={onTogglePagePanel}
            active={showPagePanel}
          >
            <PanelIcon className="h-4.5 w-4.5" />
          </IconButton>

          <Divider />

          <IconButton label="元に戻す (Cmd/Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
            <UndoIcon className="h-4.5 w-4.5" />
          </IconButton>
          <IconButton
            label="やり直す (Cmd/Ctrl+Shift+Z)"
            onClick={onRedo}
            disabled={!canRedo}
          >
            <RedoIcon className="h-4.5 w-4.5" />
          </IconButton>

          <Divider />

          <div className="flex items-center gap-0.5">
            <IconButton
              label="前のページ"
              onClick={() => onPageChange(pageIndex - 1)}
              disabled={pageIndex <= 0}
            >
              <ChevronLeftIcon className="h-4.5 w-4.5" />
            </IconButton>
            <span className="min-w-16 text-center text-sm tabular-nums text-slate-600">
              {pageIndex + 1}
              <span className="text-slate-400"> / {pageCount}</span>
            </span>
            <IconButton
              label="次のページ"
              onClick={() => onPageChange(pageIndex + 1)}
              disabled={pageIndex >= pageCount - 1}
            >
              <ChevronRightIcon className="h-4.5 w-4.5" />
            </IconButton>
          </div>

          <IconButton label="文書内を検索 (Cmd/Ctrl+F)" onClick={onToggleSearch}>
            <SearchIcon className="h-4.5 w-4.5" />
          </IconButton>

          <Divider />

          <div className="flex items-center gap-0.5">
            <IconButton label="縮小" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0]}>
              <MinusIcon className="h-4.5 w-4.5" />
            </IconButton>
            <select
              aria-label="表示倍率"
              value={zoomMode === "custom" ? String(zoom) : zoomMode}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "fit-width" || value === "fit-page") {
                  onZoomModeChange(value);
                } else {
                  onZoomChange(Number(value));
                }
              }}
              className="w-32 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
            >
              <option value="fit-width">幅に合わせる</option>
              <option value="fit-page">全体表示</option>
              {ZOOM_STEPS.map((step) => (
                <option key={step} value={step}>
                  {Math.round(step * 100)}%
                </option>
              ))}
              {zoomMode !== "custom" && (
                <option value={String(zoom)} hidden>
                  {Math.round(zoom * 100)}%
                </option>
              )}
            </select>
            <IconButton
              label="拡大"
              onClick={() => stepZoom(1)}
              disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            >
              <PlusIcon className="h-4.5 w-4.5" />
            </IconButton>
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {canExport && saveState !== "idle" && (
          <span className="hidden text-[11px] text-slate-400 lg:block">
            {saveState === "saving" ? "保存中…" : "自動保存済み"}
          </span>
        )}

        {canExport && (
          <select
            aria-label="書き出し方"
            value={exportMode}
            onChange={(event) =>
              onExportModeChange(event.target.value as ExportMode)
            }
            title="編集内容をページに焼き込むか、PDF注釈として書き出すかを選びます"
            className="hidden rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 lg:block"
          >
            <option value="flatten">焼き込み</option>
            <option value="annotate">PDF注釈</option>
          </select>
        )}

        {canExport && (
          <button
            type="button"
            onClick={() => mergeInputRef.current?.click()}
            title="別のPDFを後ろに結合する"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <MergeIcon className="h-4 w-4" />
            <span className="hidden xl:inline">結合</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          <FolderIcon className="h-4 w-4" />
          開く
        </button>

        <button
          type="button"
          onClick={onExport}
          disabled={!canExport || isExporting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isExporting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <DownloadIcon className="h-4 w-4" />
          )}
          {isExporting ? "書き出し中…" : "PDF書き出し"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          event.target.value = "";
          if (file) onOpenFile(file);
        }}
      />

      <input
        ref={mergeInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-label="結合するPDF"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          event.target.value = "";
          if (file) onMergeFile(file);
        }}
      />
    </header>
  );
}

function Divider() {
  return <span className="h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />;
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-8 w-8 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent ${
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}
