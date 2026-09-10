"use client";

import { useEffect, useRef, useState } from "react";
import { FONT_FAMILIES } from "@/lib/pdf/font";
import {
  LINE_HEIGHT_FACTOR,
  sanitizeText,
  splitLines,
} from "@/lib/pdf/textLayout";
import type { FontBook } from "@/lib/pdf/font";
import type { TextElement } from "@/types/editor";

interface InlineTextEditorProps {
  element: TextElement;
  /** 回転適用後のページ寸法（PDFポイント）。 */
  view: { width: number; height: number };
  /** 1 PDFポイントあたりの CSS ピクセル数（ズーム込み）。 */
  cssPxPerPoint: number;
  fonts: FontBook;
  /** 入力途中の内容。履歴には積まない。 */
  onPreview: (text: string) => void;
  /** 編集終了。ここで初めて履歴に 1 件積む。 */
  onFinish: (text: string) => void;
}

/**
 * その場で文字を打ち込むための <textarea>。
 *
 * 表示は SVG が担当し、この textarea は入力・キャレット・IME だけを担う。
 * 編集中は SVG 側の文字を隠して二重表示を避けている。
 *
 * 日本語入力については composition 中に親へ値を送らない。変換確定前に
 * 再レンダリングが走ると、ブラウザによっては変換候補が閉じてしまうため。
 */
export function InlineTextEditor({
  element,
  view,
  cssPxPerPoint,
  fonts,
  onPreview,
  onFinish,
}: InlineTextEditorProps) {
  const font = fonts.get(element.fontWeight);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(element.text);
  const isComposingRef = useRef(false);
  // onFinish を二重に呼ばないための番人（Escape → blur の順で発火するため）。
  const finishedRef = useRef(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.select();
  }, []);

  const { ascentRatio, descentRatio } = font.metrics;
  const fontSizePx = element.fontSize * cssPxPerPoint;
  const lineHeightPx = LINE_HEIGHT_FACTOR * fontSizePx;

  // SVG 側の 1 行目ベースライン位置に textarea の 1 行目を合わせる。
  // 行ボックス内のベースライン = ハーフレディング + アセント。
  const baselinePx =
    (element.y * view.height + ascentRatio * element.fontSize) * cssPxPerPoint;
  const halfLeading =
    (lineHeightPx - (ascentRatio + descentRatio) * fontSizePx) / 2;
  const top = baselinePx - (halfLeading + ascentRatio * fontSizePx);
  const left = element.x * view.width * cssPxPerPoint;

  // 折り返し幅が決まっている要素はその幅で、そうでなければ内容に合わせる。
  const lines = splitLines(draft);
  const naturalWidthPx =
    lines.reduce(
      (max, line) => Math.max(max, font.measureText(line, element.fontSize)),
      0,
    ) * cssPxPerPoint;
  const widthPx =
    element.width === null
      ? naturalWidthPx
      : element.width * view.width * cssPxPerPoint;

  const finish = (value: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish(sanitizeText(value));
  };

  return (
    <textarea
      ref={textareaRef}
      value={draft}
      spellCheck={false}
      wrap={element.width === null ? "off" : "soft"}
      onChange={(event) => {
        const value = event.target.value;
        setDraft(value);
        if (!isComposingRef.current) onPreview(sanitizeText(value));
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        isComposingRef.current = false;
        onPreview(sanitizeText(event.currentTarget.value));
      }}
      onBlur={(event) => finish(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // 変換確定の Enter / Escape を編集終了と取り違えない。
        if (isComposingRef.current || event.nativeEvent.isComposing) return;

        if (event.key === "Escape") {
          event.preventDefault();
          finish(draft);
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finish(draft);
        }
        // ページ送りなどの全体ショートカットへ伝播させない。
        event.stopPropagation();
      }}
      style={{
        position: "absolute",
        left,
        top,
        width: Math.max(widthPx + fontSizePx * 0.6, 48),
        height: lines.length * lineHeightPx + halfLeading * 2,
        fontFamily: `"${FONT_FAMILIES[element.fontWeight]}", sans-serif`,
        fontSize: fontSizePx,
        lineHeight: `${lineHeightPx}px`,
        color: element.color,
        textAlign: element.align,
        fontStyle: element.italic ? "oblique 12deg" : "normal",
      }}
      className={`resize-none overflow-hidden rounded-[2px] border-0 bg-white/85 p-0 shadow-[0_0_0_2px_#2563eb] outline-none ${
        element.width === null ? "whitespace-pre" : "whitespace-pre-wrap"
      }`}
    />
  );
}
