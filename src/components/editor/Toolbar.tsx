"use client";

import type { ToolId } from "@/types/editor";

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5] as const;

interface ToolbarProps {
  tool: ToolId;
  onToolChange: (tool: ToolId) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  pageIndex: number;
  pageCount: number;
  onPageChange: (index: number) => void;
}

export function Toolbar({
  tool,
  onToolChange,
  zoom,
  onZoomChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  pageIndex,
  pageCount,
  onPageChange,
}: ToolbarProps) {
  return (
    <div className="flex h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-white px-3">
      <ToolButton
        label="選択"
        isActive={tool === "select"}
        onClick={() => onToolChange("select")}
        shortcut="V"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m3 3 7.5 17 2.5-7 7-2.5z"
        />
      </ToolButton>

      <ToolButton
        label="テキスト"
        isActive={tool === "text"}
        onClick={() => onToolChange("text")}
        shortcut="T"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"
        />
      </ToolButton>

      <Divider />

      <IconButton label="元に戻す" onClick={onUndo} disabled={!canUndo}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 14 4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3"
        />
      </IconButton>
      <IconButton label="やり直す" onClick={onRedo} disabled={!canRedo}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m15 14 5-5-5-5m5 5h-9a6 6 0 0 0 0 12h3"
        />
      </IconButton>

      <Divider />

      <div className="flex items-center gap-1 text-sm text-slate-600">
        <IconButton
          label="前のページ"
          onClick={() => onPageChange(pageIndex - 1)}
          disabled={pageIndex <= 0}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 5-7 7 7 7" />
        </IconButton>
        <span className="min-w-20 text-center tabular-nums">
          {pageIndex + 1} / {pageCount}
        </span>
        <IconButton
          label="次のページ"
          onClick={() => onPageChange(pageIndex + 1)}
          disabled={pageIndex >= pageCount - 1}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
        </IconButton>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <label className="text-xs text-slate-500" htmlFor="zoom-select">
          ズーム
        </label>
        <select
          id="zoom-select"
          value={zoom}
          onChange={(event) => onZoomChange(Number(event.target.value))}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900"
        >
          {ZOOM_LEVELS.map((level) => (
            <option key={level} value={level}>
              {Math.round(level * 100)}%
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />;
}

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolButton({
  label,
  shortcut,
  isActive,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
        isActive
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        className="h-4 w-4"
      >
        {children}
      </svg>
      {label}
    </button>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function IconButton({ label, onClick, disabled, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        className="h-4 w-4"
      >
        {children}
      </svg>
    </button>
  );
}
