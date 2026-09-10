"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createFallbackFont, loadJapaneseFont } from "@/lib/pdf/font";
import type { FontBook, LoadedFont } from "@/lib/pdf/font";
import type { FontWeight } from "@/types/editor";

export interface FontBookState {
  fonts: FontBook;
  /** 通常ウェイトが読み込めたか。位置計測が実測値になったかの目安。 */
  isReady: boolean;
  error: string | null;
  /** そのウェイトを使う要素が現れたときに呼ぶ。未読なら取得を始める。 */
  requestWeight: (weight: FontWeight) => void;
}

const WEIGHTS: FontWeight[] = ["regular", "bold"];

/**
 * ウェイトごとの日本語フォントをまとめて扱う。
 *
 * 1 本 5MB 強あるため、Bold は実際に使われるまで取りに行かない。
 * 読み込みが終わるまでは近似メトリクスのフォントで代用し、
 * 書き出し時には必ず実フォントを使う。
 */
export function useFontBook(enabled: boolean): FontBookState {
  const [loaded, setLoaded] = useState<Partial<Record<FontWeight, LoadedFont>>>(
    {},
  );
  const [requested, setRequested] = useState<FontWeight[]>(["regular"]);
  const [error, setError] = useState<string | null>(null);

  const fallbacks = useMemo(
    () => ({
      regular: createFallbackFont("regular"),
      bold: createFallbackFont("bold"),
    }),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    for (const weight of WEIGHTS) {
      if (!requested.includes(weight) || loaded[weight]) continue;

      loadJapaneseFont(weight).then(
        (font) => {
          if (!cancelled) {
            setLoaded((previous) => ({ ...previous, [weight]: font }));
          }
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
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, requested, loaded]);

  const requestWeight = useCallback((weight: FontWeight) => {
    setRequested((previous) =>
      previous.includes(weight) ? previous : [...previous, weight],
    );
  }, []);

  const fonts = useMemo<FontBook>(
    () => ({
      get: (weight) => loaded[weight] ?? fallbacks[weight],
      loaded: () =>
        WEIGHTS.map((weight) => loaded[weight]).filter(
          (font): font is LoadedFont => font !== undefined,
        ),
    }),
    [loaded, fallbacks],
  );

  return {
    fonts,
    isReady: loaded.regular !== undefined,
    error,
    requestWeight,
  };
}
