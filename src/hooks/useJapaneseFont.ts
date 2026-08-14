"use client";

import { useEffect, useMemo, useState } from "react";
import { createFallbackFont, loadJapaneseFont } from "@/lib/pdf/font";
import type { LoadedFont } from "@/lib/pdf/font";

export interface JapaneseFontState {
  /** 実フォント、または読み込み完了までの近似フォント。 */
  font: LoadedFont;
  isReady: boolean;
  error: string | null;
}

/**
 * 日本語フォントを読み込む。
 * 5MB 強あるため、PDF を開いた直後ではなくエディタ表示と同時に取得を始める。
 */
export function useJapaneseFont(enabled: boolean): JapaneseFontState {
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fallback = useMemo(() => createFallbackFont(), []);

  useEffect(() => {
    if (!enabled || font) return;

    let cancelled = false;
    loadJapaneseFont().then(
      (loaded) => {
        if (!cancelled) setFont(loaded);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "日本語フォントの読み込みに失敗しました。",
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [enabled, font]);

  return { font: font ?? fallback, isReady: font !== null, error };
}
