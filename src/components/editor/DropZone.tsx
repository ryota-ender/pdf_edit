"use client";

import { useCallback, useRef, useState } from "react";
import {
  ArrowIcon,
  CircleIcon,
  HighlightIcon,
  ImageIcon,
  LockIcon,
  PenIcon,
  SquareIcon,
  TextIcon,
  UploadIcon,
} from "./Icons";

interface DropZoneProps {
  onFile: (file: File) => void;
  isLoading: boolean;
  error: string | null;
  onDismissError: () => void;
}

const CAPABILITIES = [
  { Icon: TextIcon, label: "テキスト" },
  { Icon: HighlightIcon, label: "ハイライト" },
  { Icon: PenIcon, label: "フリーハンド" },
  { Icon: SquareIcon, label: "四角形" },
  { Icon: CircleIcon, label: "円" },
  { Icon: ArrowIcon, label: "矢印" },
  { Icon: ImageIcon, label: "画像" },
];

/** PDF 未読み込み時の初期画面。 */
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
      <div className="w-full max-w-xl">
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
          className={`rounded-2xl border-2 border-dashed bg-white px-8 py-14 text-center shadow-sm transition-colors ${
            isDragging
              ? "border-blue-500 bg-blue-50/60"
              : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <UploadIcon className="mx-auto h-12 w-12 text-slate-300" />

          <h2 className="mt-5 text-xl font-semibold text-slate-800">
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
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
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

          <div className="mt-8 border-t border-slate-100 pt-6">
            <p className="text-xs font-medium text-slate-400">
              追加できる編集要素
            </p>
            <ul className="mt-3 flex flex-wrap justify-center gap-2">
              {CAPABILITIES.map(({ Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <LockIcon className="h-3.5 w-3.5" />
          PDFはサーバーへアップロードされません。すべての処理はブラウザ内で完結します。
        </p>

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
