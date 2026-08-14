"use client";

import { useCallback, useRef, useState } from "react";

interface DropZoneProps {
  onFile: (file: File) => void;
  isLoading: boolean;
  error: string | null;
  onDismissError: () => void;
}

/** PDF 未読み込み時の初期画面。ドラッグ&ドロップとファイル選択に対応する。 */
export function DropZone({
  onFile,
  isLoading,
  error,
  onDismissError,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter / dragleave は子要素を跨ぐたびに発火するので、深さを数えて
  // 本当にゾーンから出たときだけハイライトを消す。
  const dragDepthRef = useRef(0);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      if (isLoading) return;

      const file = event.dataTransfer.files.item(0);
      if (file) onFile(file);
    },
    [isLoading, onFile],
  );

  return (
    <div className="flex flex-1 items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-2xl">
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepthRef.current -= 1;
            if (dragDepthRef.current <= 0) {
              dragDepthRef.current = 0;
              setIsDragging(false);
            }
          }}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed bg-white px-8 py-16 text-center shadow-sm transition-colors ${
            isDragging
              ? "border-blue-500 bg-blue-50/60"
              : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="mx-auto h-14 w-14 text-slate-300"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V4.5m0 0L7.5 9M12 4.5 16.5 9M3.75 15.75v2.25a2.25 2.25 0 0 0 2.25 2.25h12a2.25 2.25 0 0 0 2.25-2.25v-2.25"
            />
          </svg>

          <h2 className="mt-6 text-xl font-semibold text-slate-800">
            PDFをここにドロップ
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            またはファイルを選択してください
          </p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isLoading}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isLoading ? (
              <>
                <Spinner />
                読み込み中…
              </>
            ) : (
              "ファイルを選択"
            )}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.item(0);
              // 同じファイルを続けて選び直せるように値を空へ戻す。
              event.target.value = "";
              if (file) onFile(file);
            }}
          />

          <p className="mt-8 text-xs leading-relaxed text-slate-400">
            PDFはサーバーへアップロードされません。すべての処理はお使いのブラウザ内で完結します。
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={onDismissError}
              className="shrink-0 rounded px-1 text-red-500 hover:text-red-800"
              aria-label="エラーを閉じる"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}
