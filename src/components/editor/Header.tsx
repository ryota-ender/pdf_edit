"use client";

import { useRef } from "react";

interface HeaderProps {
  fileName: string | null;
  onOpenFile: (file: File) => void;
  onExport: () => void;
  isExporting: boolean;
  canExport: boolean;
}

export function Header({
  fileName,
  onOpenFile,
  onExport,
  isExporting,
  canExport,
}: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-[11px] font-bold text-white">
          PDF
        </span>
        <h1 className="text-sm font-semibold text-slate-800">PDF Editor</h1>
      </div>

      {fileName && (
        <p
          className="hidden min-w-0 flex-1 truncate text-sm text-slate-500 sm:block"
          title={fileName}
        >
          {fileName}
        </p>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          開く
        </button>

        <button
          type="button"
          onClick={onExport}
          disabled={!canExport || isExporting}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isExporting && (
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
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
    </header>
  );
}
