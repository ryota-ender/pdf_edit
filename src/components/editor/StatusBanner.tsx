"use client";

export type BannerTone = "error" | "info";

interface StatusBannerProps {
  message: string;
  tone: BannerTone;
  onDismiss: () => void;
}

/** 画面下部に出る通知。エラーは必ず日本語の文言で表示する。 */
export function StatusBanner({ message, tone, onDismiss }: StatusBannerProps) {
  const isError = tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div
        className={`pointer-events-auto flex max-w-xl items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
          isError
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-slate-200 bg-white text-slate-700"
        }`}
      >
        <span className="flex-1 leading-relaxed">{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="通知を閉じる"
          className={`shrink-0 rounded px-1 ${
            isError
              ? "text-red-500 hover:text-red-800"
              : "text-slate-400 hover:text-slate-700"
          }`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
