"use client";

import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  sanitizeText,
} from "@/lib/pdf/textLayout";
import { clamp } from "@/lib/pdf/coordinates";
import { ELEMENT_LABELS } from "@/lib/pdf/elementDefaults";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  DuplicateIcon,
  RotateIcon,
  TrashIcon,
} from "./Icons";
import type { EditorElement, PageState, TextElement } from "@/types/editor";
import { isBoxElement } from "@/types/editor";

/** パネル幅に 1 行で収まる数に絞っている。任意の色はカラーピッカーから。 */
const TEXT_COLORS = [
  "#111827",
  "#dc2626",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#ffffff",
];

const HIGHLIGHT_COLORS = [
  "#fde047",
  "#86efac",
  "#7dd3fc",
  "#fda4af",
  "#d8b4fe",
  "#fdba74",
];

interface InspectorProps {
  selected: EditorElement[];
  page: PageState | null;
  pageIndex: number;
  pageCount: number;
  /** 履歴に積まない更新（スライダーのドラッグ中など）。 */
  onPreview: (patch: Partial<EditorElement>) => void;
  /** 履歴に 1 件積む更新。 */
  onCommit: (patch: Partial<EditorElement>) => void;
  onBeginTransaction: () => void;
  onEndTransaction: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRotatePage: () => void;
  onDeletePage: () => void;
}

/** 右側のプロパティ欄。選択している要素の種類に応じて中身が変わる。 */
export function Inspector({
  selected,
  page,
  pageIndex,
  pageCount,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
  onDelete,
  onDuplicate,
  onRotatePage,
  onDeletePage,
}: InspectorProps) {
  const single = selected.length === 1 ? selected[0] : null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex h-9 shrink-0 items-center justify-between px-4">
        <span className="text-xs font-semibold tracking-wide text-slate-500">
          {selected.length === 0
            ? "プロパティ"
            : single
              ? ELEMENT_LABELS[single.type]
              : `${selected.length} 個を選択中`}
        </span>
        {selected.length > 0 && (
          <div className="flex items-center gap-0.5">
            <IconAction label="複製 (Cmd/Ctrl+D)" onClick={onDuplicate}>
              <DuplicateIcon className="h-4 w-4" />
            </IconAction>
            <IconAction label="削除 (Delete)" onClick={onDelete} danger>
              <TrashIcon className="h-4 w-4" />
            </IconAction>
          </div>
        )}
      </div>

      <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto px-4 pb-6">
        {selected.length === 0 && (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
            要素が選択されていません。
            <br />
            左のツールを選んでページ上を
            <br />
            クリック / ドラッグすると追加できます。
          </p>
        )}

        {single?.type === "text" && (
          <TextSection
            element={single}
            onPreview={onPreview}
            onCommit={onCommit}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
          />
        )}

        {(single?.type === "rect" || single?.type === "ellipse") && (
          <ShapeSection
            element={single}
            onPreview={onPreview}
            onCommit={onCommit}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
          />
        )}

        {single?.type === "highlight" && (
          <Field label="マーカー色">
            <Swatches
              colors={HIGHLIGHT_COLORS}
              value={single.color}
              onPick={(color) => onCommit({ color })}
            />
          </Field>
        )}

        {(single?.type === "arrow" || single?.type === "pen") && (
          <StrokeSection
            element={single}
            onPreview={onPreview}
            onCommit={onCommit}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
          />
        )}

        {single && (
          <>
            <Field label={`不透明度 (${Math.round(single.opacity * 100)}%)`}>
              <input
                type="range"
                min={10}
                max={100}
                step={1}
                value={Math.round(single.opacity * 100)}
                onPointerDown={onBeginTransaction}
                onChange={(event) =>
                  onPreview({ opacity: Number(event.target.value) / 100 })
                }
                onPointerUp={onEndTransaction}
                onKeyDown={onBeginTransaction}
                onKeyUp={onEndTransaction}
                aria-label="不透明度"
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
              />
            </Field>

            {isBoxElement(single) && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="X (%)" htmlFor="prop-x">
                  <PercentInput
                    id="prop-x"
                    value={single.x}
                    onCommit={(x) => onCommit({ x })}
                  />
                </Field>
                <Field label="Y (%)" htmlFor="prop-y">
                  <PercentInput
                    id="prop-y"
                    value={single.y}
                    onCommit={(y) => onCommit({ y })}
                  />
                </Field>
                <Field label="幅 (%)" htmlFor="prop-w">
                  <PercentInput
                    id="prop-w"
                    value={single.w}
                    onCommit={(w) => onCommit({ w })}
                  />
                </Field>
                <Field label="高さ (%)" htmlFor="prop-h">
                  <PercentInput
                    id="prop-h"
                    value={single.h}
                    onCommit={(h) => onCommit({ h })}
                  />
                </Field>
              </div>
            )}

            {single.type === "text" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="X (%)" htmlFor="prop-x">
                  <PercentInput
                    id="prop-x"
                    value={single.x}
                    onCommit={(x) => onCommit({ x })}
                  />
                </Field>
                <Field label="Y (%)" htmlFor="prop-y">
                  <PercentInput
                    id="prop-y"
                    value={single.y}
                    onCommit={(y) => onCommit({ y })}
                  />
                </Field>
              </div>
            )}
          </>
        )}

        {page && (
          <section className="border-t border-slate-200 pt-4">
            <h3 className="text-xs font-semibold text-slate-500">ページ</h3>
            <p className="mt-2 text-xs text-slate-500">
              {pageIndex + 1} / {pageCount} ページ
              {page.rotation !== 0 && `（${page.rotation}° 回転）`}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onRotatePage}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <RotateIcon className="h-3.5 w-3.5" />
                90°回転
              </button>
              <button
                type="button"
                onClick={onDeletePage}
                disabled={pageCount <= 1}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-300 disabled:hover:bg-transparent"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                ページ削除
              </button>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

interface SectionProps<T extends EditorElement> {
  element: T;
  onPreview: (patch: Partial<EditorElement>) => void;
  onCommit: (patch: Partial<EditorElement>) => void;
  onBeginTransaction: () => void;
  onEndTransaction: () => void;
}

function TextSection({
  element,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
}: SectionProps<TextElement>) {
  const alignments = [
    { value: "left", label: "左揃え", Icon: AlignLeftIcon },
    { value: "center", label: "中央揃え", Icon: AlignCenterIcon },
    { value: "right", label: "右揃え", Icon: AlignRightIcon },
  ] as const;

  return (
    <>
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

      <Field label={`フォントサイズ (${Math.round(element.fontSize)}pt)`}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={Math.round(element.fontSize)}
            onPointerDown={onBeginTransaction}
            onChange={(event) =>
              onPreview({ fontSize: Number(event.target.value) })
            }
            onPointerUp={onEndTransaction}
            onKeyDown={onBeginTransaction}
            onKeyUp={onEndTransaction}
            aria-label="フォントサイズ"
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
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
            aria-label="フォントサイズ（数値）"
            className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm tabular-nums text-slate-800 focus-visible:border-blue-500 focus-visible:outline-none"
          />
        </div>
      </Field>

      <Field label="行揃え">
        <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
          {alignments.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={element.align === value}
              onClick={() => onCommit({ align: value })}
              className={`grid h-7 w-9 place-items-center rounded-md transition-colors ${
                element.align === value
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </Field>

      <Field label="文字色">
        <Swatches
          colors={TEXT_COLORS}
          value={element.color}
          onPick={(color) => onCommit({ color })}
          allowCustom
          onCustomBegin={onBeginTransaction}
          onCustomChange={(color) => onPreview({ color })}
          onCustomEnd={onEndTransaction}
        />
      </Field>
    </>
  );
}

function ShapeSection({
  element,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
}: SectionProps<Extract<EditorElement, { type: "rect" | "ellipse" }>>) {
  return (
    <>
      <Field label="枠線の色">
        <Swatches
          colors={TEXT_COLORS}
          value={element.stroke}
          onPick={(color) => onCommit({ stroke: color })}
          allowNone
          onPickNone={() => onCommit({ stroke: null })}
          allowCustom
          onCustomBegin={onBeginTransaction}
          onCustomChange={(color) => onPreview({ stroke: color })}
          onCustomEnd={onEndTransaction}
        />
      </Field>

      <Field label="塗りつぶし">
        <Swatches
          colors={TEXT_COLORS}
          value={element.fill}
          onPick={(color) => onCommit({ fill: color })}
          allowNone
          onPickNone={() => onCommit({ fill: null })}
          allowCustom
          onCustomBegin={onBeginTransaction}
          onCustomChange={(color) => onPreview({ fill: color })}
          onCustomEnd={onEndTransaction}
        />
      </Field>

      <StrokeWidthField
        value={element.strokeWidth}
        onPreview={(strokeWidth) => onPreview({ strokeWidth })}
        onBeginTransaction={onBeginTransaction}
        onEndTransaction={onEndTransaction}
      />

      {element.type === "rect" && (
        <Field label={`角丸 (${Math.round(element.radius)}pt)`}>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={element.radius}
            onPointerDown={onBeginTransaction}
            onChange={(event) =>
              onPreview({ radius: Number(event.target.value) })
            }
            onPointerUp={onEndTransaction}
            aria-label="角丸"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
          />
        </Field>
      )}
    </>
  );
}

function StrokeSection({
  element,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
}: SectionProps<Extract<EditorElement, { type: "arrow" | "pen" }>>) {
  return (
    <>
      <Field label="線の色">
        <Swatches
          colors={TEXT_COLORS}
          value={element.color}
          onPick={(color) => onCommit({ color })}
          allowCustom
          onCustomBegin={onBeginTransaction}
          onCustomChange={(color) => onPreview({ color })}
          onCustomEnd={onEndTransaction}
        />
      </Field>

      <StrokeWidthField
        value={element.strokeWidth}
        onPreview={(strokeWidth) => onPreview({ strokeWidth })}
        onBeginTransaction={onBeginTransaction}
        onEndTransaction={onEndTransaction}
      />

      {element.type === "arrow" && (
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={element.head}
            onChange={(event) => onCommit({ head: event.target.checked })}
            className="h-4 w-4 accent-blue-600"
          />
          矢印の先端をつける
        </label>
      )}
    </>
  );
}

function StrokeWidthField({
  value,
  onPreview,
  onBeginTransaction,
  onEndTransaction,
}: {
  value: number;
  onPreview: (value: number) => void;
  onBeginTransaction: () => void;
  onEndTransaction: () => void;
}) {
  return (
    <Field label={`線の太さ (${value.toFixed(1)}pt)`}>
      <input
        type="range"
        min={0.5}
        max={20}
        step={0.5}
        value={value}
        onPointerDown={onBeginTransaction}
        onChange={(event) => onPreview(Number(event.target.value))}
        onPointerUp={onEndTransaction}
        onKeyDown={onBeginTransaction}
        onKeyUp={onEndTransaction}
        aria-label="線の太さ"
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------

interface SwatchesProps {
  colors: string[];
  value: string | null;
  onPick: (color: string) => void;
  allowNone?: boolean;
  onPickNone?: () => void;
  allowCustom?: boolean;
  onCustomBegin?: () => void;
  onCustomChange?: (color: string) => void;
  onCustomEnd?: () => void;
}

function Swatches({
  colors,
  value,
  onPick,
  allowNone,
  onPickNone,
  allowCustom,
  onCustomBegin,
  onCustomChange,
  onCustomEnd,
}: SwatchesProps) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {allowCustom && (
        <input
          type="color"
          value={value ?? "#000000"}
          onPointerDown={onCustomBegin}
          onChange={(event) => onCustomChange?.(event.target.value)}
          onBlur={onCustomEnd}
          aria-label="色を選ぶ"
          className="h-7 w-8 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
        />
      )}
      {allowNone && (
        <button
          type="button"
          onClick={onPickNone}
          title="なし"
          aria-label="なし"
          aria-pressed={value === null}
          className={`relative h-6 w-6 overflow-hidden rounded border bg-white transition-transform hover:scale-110 ${
            value === null ? "border-blue-500 ring-2 ring-blue-500/30" : "border-slate-300"
          }`}
        >
          <span className="absolute inset-0 m-auto h-px w-8 origin-center rotate-45 bg-red-400" />
        </button>
      )}
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onPick(color)}
          title={color}
          aria-label={`色を ${color} にする`}
          aria-pressed={value?.toLowerCase() === color}
          className={`h-6 w-6 rounded border transition-transform hover:scale-110 ${
            value?.toLowerCase() === color
              ? "border-blue-500 ring-2 ring-blue-500/30"
              : "border-slate-300"
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function PercentInput({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: number;
  onCommit: (value: number) => void;
}) {
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
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

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
        danger
          ? "text-slate-500 hover:bg-red-50 hover:text-red-600"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
