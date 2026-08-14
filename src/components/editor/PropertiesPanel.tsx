"use client";

import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  sanitizeText,
} from "@/lib/pdf/textLayout";
import { clamp } from "@/lib/pdf/coordinates";
import type { PageState, TextElement } from "@/types/editor";

const PRESET_COLORS = [
  "#111827",
  "#dc2626",
  "#ea580c",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#ffffff",
];

interface PropertiesPanelProps {
  element: TextElement | null;
  page: PageState | null;
  pageIndex: number;
  pageCount: number;
  /** 履歴に積まない更新（スライダーのドラッグ中など）。 */
  onPreview: (patch: Partial<TextElement>) => void;
  /** 履歴に 1 件積む更新。 */
  onCommit: (patch: Partial<TextElement>) => void;
  onBeginTransaction: () => void;
  onEndTransaction: () => void;
  onDelete: () => void;
  onRotatePage: () => void;
  onDeletePage: () => void;
}

export function PropertiesPanel({
  element,
  page,
  pageIndex,
  pageCount,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
  onDelete,
  onRotatePage,
  onDeletePage,
}: PropertiesPanelProps) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
      <div className="flex h-9 shrink-0 items-center px-4 text-xs font-semibold tracking-wide text-slate-500">
        プロパティ
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-4 pb-6">
        {element ? (
          <TextProperties
            element={element}
            onPreview={onPreview}
            onCommit={onCommit}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
            onDelete={onDelete}
          />
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
            要素が選択されていません。
            <br />
            テキストツールでページをクリックすると
            <br />
            文字を追加できます。
          </p>
        )}

        {page && (
          <section className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="text-xs font-semibold text-slate-500">ページ</h3>
            <p className="mt-2 text-xs text-slate-500">
              {pageIndex + 1} / {pageCount} ページ
              {page.rotation !== 0 && `（${page.rotation}° 回転）`}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onRotatePage}
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                90°回転
              </button>
              <button
                type="button"
                onClick={onDeletePage}
                disabled={pageCount <= 1}
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-300 disabled:hover:bg-transparent"
              >
                ページ削除
              </button>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

interface TextPropertiesProps {
  element: TextElement;
  onPreview: (patch: Partial<TextElement>) => void;
  onCommit: (patch: Partial<TextElement>) => void;
  onBeginTransaction: () => void;
  onEndTransaction: () => void;
  onDelete: () => void;
}

function TextProperties({
  element,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
  onDelete,
}: TextPropertiesProps) {
  return (
    <div className="space-y-5">
      <Field label="テキスト" htmlFor="prop-text">
        <textarea
          id="prop-text"
          value={element.text}
          rows={3}
          spellCheck={false}
          onFocus={onBeginTransaction}
          onChange={(event) =>
            onPreview({ text: sanitizeText(event.target.value) })
          }
          onBlur={onEndTransaction}
          className="w-full resize-y rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-800 focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue-500/30"
        />
      </Field>

      <Field label={`フォントサイズ (${Math.round(element.fontSize)})`}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={element.fontSize}
            onPointerDown={onBeginTransaction}
            onChange={(event) =>
              onPreview({ fontSize: Number(event.target.value) })
            }
            onPointerUp={onEndTransaction}
            onKeyDown={onBeginTransaction}
            onKeyUp={onEndTransaction}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
            aria-label="フォントサイズ"
          />
          <input
            type="number"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            value={Math.round(element.fontSize)}
            onChange={(event) =>
              onCommit({
                fontSize: clamp(
                  Number(event.target.value) || MIN_FONT_SIZE,
                  MIN_FONT_SIZE,
                  MAX_FONT_SIZE,
                ),
              })
            }
            className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm tabular-nums text-slate-800 focus-visible:border-blue-500 focus-visible:outline-none"
            aria-label="フォントサイズ（数値）"
          />
        </div>
      </Field>

      <Field label="文字色">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={element.color}
            onPointerDown={onBeginTransaction}
            onChange={(event) => onPreview({ color: event.target.value })}
            onBlur={onEndTransaction}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            aria-label="文字色"
          />
          <div className="flex flex-wrap gap-1">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onCommit({ color })}
                title={color}
                aria-label={`色を ${color} にする`}
                className={`h-5 w-5 rounded border transition-transform hover:scale-110 ${
                  element.color.toLowerCase() === color
                    ? "border-blue-500 ring-2 ring-blue-500/30"
                    : "border-slate-300"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="X (%)" htmlFor="prop-x">
          <PositionInput
            id="prop-x"
            value={element.x}
            onCommit={(value) => onCommit({ x: value })}
          />
        </Field>
        <Field label="Y (%)" htmlFor="prop-y">
          <PositionInput
            id="prop-y"
            value={element.y}
            onCommit={(value) => onCommit({ y: value })}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
      >
        削除
      </button>
    </div>
  );
}

interface PositionInputProps {
  id: string;
  /** 正規化座標 (0〜1)。UI ではパーセント表示にする。 */
  value: number;
  onCommit: (value: number) => void;
}

function PositionInput({ id, value, onCommit }: PositionInputProps) {
  return (
    <input
      id={id}
      type="number"
      min={0}
      max={100}
      step={0.1}
      value={Number((value * 100).toFixed(1))}
      onChange={(event) =>
        onCommit(clamp(Number(event.target.value) / 100 || 0, 0, 1))
      }
      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums text-slate-800 focus-visible:border-blue-500 focus-visible:outline-none"
    />
  );
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-slate-600"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
