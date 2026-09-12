"use client";

import { useEffect, useRef, useState } from "react";
import { TAB_ID, saveSession, sessionIdFor } from "@/lib/pdf/persistence";
import type { StoredImage, StoredSource } from "@/lib/pdf/persistence";
import type { ImageAssetStore } from "@/lib/pdf/imageAssets";
import type { EditorDoc } from "@/types/editor";

export type SaveState = "idle" | "saving" | "saved";

interface UseAutosaveOptions {
  enabled: boolean;
  doc: EditorDoc;
  sources: StoredSource[];
  images: ImageAssetStore;
  /** フォーム欄へ記入した値も一緒に保存する。 */
  formValues: Record<string, string>;
}

/** 書き込みが多すぎないよう、変更が落ち着いてから保存する。 */
const DEBOUNCE_MS = 1200;

/**
 * 編集内容を IndexedDB へ自動保存する。
 *
 * 元 PDF のバイト列は大きいので、毎回は書き込まない。ページ構成や要素が
 * 変わったときだけ、少し待ってからまとめて保存する。
 */
export function useAutosave({
  enabled,
  doc,
  sources,
  images,
  formValues,
}: UseAutosaveOptions): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // 変更が落ち着くまで待ってから、そのときの値をまとめて書き出す。
    const current = { doc, sources, images, formValues };

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setState("saving");

      const storedImages: StoredImage[] = [];
      for (const element of current.doc.elements) {
        if (element.type !== "image") continue;
        if (storedImages.some((item) => item.id === element.assetId)) continue;
        const asset = current.images.get(element.assetId);
        if (!asset) continue;
        storedImages.push({
          id: asset.id,
          format: asset.format,
          width: asset.width,
          height: asset.height,
          bytes: asset.bytes,
        });
      }

      saveSession({
        id: sessionIdFor(current.sources.map((source) => source.fileName)),
        savedAt: Date.now(),
        doc: current.doc,
        sources: current.sources,
        images: storedImages,
        formValues: current.formValues,
        ownerId: TAB_ID,
      }).then(
        () => setState("saved"),
        () => setState("idle"),
      );
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, doc, sources, images, formValues]);

  return state;
}
