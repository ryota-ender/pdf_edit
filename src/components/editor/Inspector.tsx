"use client";

import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  sanitizeText,
} from "@/lib/pdf/textLayout";
import { clamp } from "@/lib/pdf/coordinates";
import type { Unit } from "@/lib/pdf/units";
import { formatLength, parseLength, UNIT_LABELS } from "@/lib/pdf/units";
import { ELEMENT_LABELS } from "@/lib/pdf/elementDefaults";
import type { AlignMode } from "@/lib/pdf/geometry";
import type { SavedStamp } from "@/lib/pdf/stamps";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  BringForwardIcon,
  DuplicateIcon,
  GroupIcon,
  ItalicIcon,
  LockIcon,
  RotateIcon,
  SendBackwardIcon,
  CropIcon,
  PipetteIcon,
  PlusPageIcon,
  StampIcon,
  TrashIcon,
  UngroupIcon,
  UnlockIcon,
  WrapIcon,
} from "./Icons";
import type {
  CalloutElement,
  EditorElement,
  PageSize,
  PageState,
  TextElement,
} from "@/types/editor";
import { PAPER_SIZES, isBoxElement, isShapeElement } from "@/types/editor";

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
  stamps: SavedStamp[];
  /** 位置とサイズの表示単位。 */
  unit: Unit;
  onUnitChange: (unit: Unit) => void;
  /** 表示中のページの寸法（PDFポイント）。単位換算に使う。 */
  pageSize: PageSize;
  /** 直近に使った色。 */
  recentColors: string[];
  onPreview: (patch: Partial<EditorElement>) => void;
  onCommit: (patch: Partial<EditorElement>) => void;
  onBeginTransaction: () => void;
  onEndTransaction: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onReorder: (direction: "front" | "back" | "forward" | "backward") => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleLock: () => void;
  onSaveStamp: () => void;
  onPlaceStamp: (stamp: SavedStamp) => void;
  onDeleteStamp: (id: string) => void;
  onRotatePage: () => void;
  onDeletePage: () => void;
  onExtractPage: () => void;
  onInsertBlankPage: () => void;
  onCropPage: () => void;
  onClearCrop: () => void;
  onResizePage: (size: PageSize | null) => void;
}

/** 右側のプロパティ欄。選択している要素の種類に応じて中身が変わる。 */
export function Inspector({
  selected,
  page,
  pageIndex,
  pageCount,
  stamps,
  unit,
  onUnitChange,
  pageSize,
  recentColors,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
  onDelete,
  onDuplicate,
  onReorder,
  onAlign,
  onDistribute,
  onGroup,
  onUngroup,
  onToggleLock,
  onSaveStamp,
  onPlaceStamp,
  onDeleteStamp,
  onRotatePage,
  onDeletePage,
  onExtractPage,
  onInsertBlankPage,
  onCropPage,
  onClearCrop,
  onResizePage,
}: InspectorProps) {
  const single = selected.length === 1 ? selected[0] : null;
  const isLocked = selected.length > 0 && selected.every((item) => item.locked);
  const hasGroup = selected.some((item) => item.groupId !== null);

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
            <IconAction
              label={isLocked ? "ロックを解除" : "ロック"}
              onClick={onToggleLock}
              active={isLocked}
            >
              {isLocked ? (
                <LockIcon className="h-4 w-4" />
              ) : (
                <UnlockIcon className="h-4 w-4" />
              )}
            </IconAction>
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

        {selected.length > 0 && (
          <ArrangeSection
            count={selected.length}
            hasGroup={hasGroup}
            onReorder={onReorder}
            onAlign={onAlign}
            onDistribute={onDistribute}
            onGroup={onGroup}
            onUngroup={onUngroup}
            onSaveStamp={onSaveStamp}
          />
        )}

        {single?.type === "text" && (
          <TextSection
            element={single}
            recent={recentColors}
            onPreview={onPreview}
            onCommit={onCommit}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
          />
        )}

        {single?.type === "callout" && (
          <CalloutSection
            element={single}
            recent={recentColors}
            onPreview={onPreview}
            onCommit={onCommit}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
          />
        )}

        {single && isShapeElement(single) && (
          <ShapeSection
            element={single}
            recent={recentColors}
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
              recent={recentColors}
            />
          </Field>
        )}

        {(single?.type === "arrow" || single?.type === "pen") && (
          <StrokeSection
            element={single}
            recent={recentColors}
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

            <Field label={`回転 (${Math.round(single.rotation)}°)`}>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={Math.round(single.rotation)}
                  onPointerDown={onBeginTransaction}
                  onChange={(event) =>
                    onPreview({ rotation: Number(event.target.value) })
                  }
                  onPointerUp={onEndTransaction}
                  aria-label="回転"
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
                />
                <button
                  type="button"
                  onClick={() => onCommit({ rotation: 0 })}
                  title="回転をもとに戻す"
                  className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  0°
                </button>
              </div>
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  位置とサイズ
                </span>
                <select
                  value={unit}
                  onChange={(event) => onUnitChange(event.target.value as Unit)}
                  aria-label="単位"
                  className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-600"
                >
                  {Object.entries(UNIT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="X" htmlFor="prop-x">
                  <LengthInput
                    id="prop-x"
                    value={"x" in single ? single.x : 0}
                    total={pageSize.width}
                    unit={unit}
                    onCommit={(x) => onCommit({ x })}
                    disabled={!("x" in single)}
                  />
                </Field>
                <Field label="Y" htmlFor="prop-y">
                  <LengthInput
                    id="prop-y"
                    value={"y" in single ? single.y : 0}
                    total={pageSize.height}
                    unit={unit}
                    onCommit={(y) => onCommit({ y })}
                    disabled={!("y" in single)}
                  />
                </Field>
                {isBoxElement(single) && (
                  <>
                    <Field label="幅" htmlFor="prop-w">
                      <LengthInput
                        id="prop-w"
                        value={single.w}
                        total={pageSize.width}
                        unit={unit}
                        onCommit={(w) => onCommit({ w })}
                      />
                    </Field>
                    <Field label="高さ" htmlFor="prop-h">
                      <LengthInput
                        id="prop-h"
                        value={single.h}
                        total={pageSize.height}
                        unit={unit}
                        onCommit={(h) => onCommit({ h })}
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {stamps.length > 0 && (
          <section className="border-t border-slate-200 pt-4">
            <h3 className="text-xs font-semibold text-slate-500">
              保存したスタンプ
            </h3>
            <ul className="mt-2 space-y-1">
              {stamps.map((stamp) => (
                <li key={stamp.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onPlaceStamp(stamp)}
                    className="flex-1 truncate rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
                    aria-label={`${stamp.label} を配置`}
                    title={`${stamp.label} を配置`}
                  >
                    {stamp.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteStamp(stamp.id)}
                    aria-label={`${stamp.label} を削除`}
                    className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {page && (
          <section className="border-t border-slate-200 pt-4">
            <h3 className="text-xs font-semibold text-slate-500">ページ</h3>
            <p className="mt-2 text-xs text-slate-500">
              {pageIndex + 1} / {pageCount} ページ
              {page.rotation !== 0 && `（${page.rotation}° 回転）`}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <SmallButton onClick={onRotatePage} icon={<RotateIcon className="h-3.5 w-3.5" />}>
                90°回転
              </SmallButton>
              <SmallButton
                onClick={onExtractPage}
                icon={<DuplicateIcon className="h-3.5 w-3.5" />}
              >
                ページ抽出
              </SmallButton>
              <SmallButton
                onClick={onInsertBlankPage}
                icon={<PlusPageIcon className="h-3.5 w-3.5" />}
              >
                白紙を挿入
              </SmallButton>
              <SmallButton
                onClick={page.crop ? onClearCrop : onCropPage}
                icon={<CropIcon className="h-3.5 w-3.5" />}
              >
                {page.crop ? "切り抜き解除" : "選択範囲で切抜"}
              </SmallButton>
              <SmallButton
                onClick={onDeletePage}
                disabled={pageCount <= 1}
                danger
                icon={<TrashIcon className="h-3.5 w-3.5" />}
              >
                ページ削除
              </SmallButton>
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                用紙サイズ
              </span>
              <select
                aria-label="用紙サイズ"
                value={
                  page.resizeTo
                    ? `${page.resizeTo.width}x${page.resizeTo.height}`
                    : ""
                }
                onChange={(event) => {
                  const found = PAPER_SIZES.find(
                    (paper) =>
                      `${paper.size.width}x${paper.size.height}` ===
                      event.target.value,
                  );
                  onResizePage(found ? found.size : null);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus-visible:border-blue-500 focus-visible:outline-none"
              >
                <option value="">元のまま</option>
                {PAPER_SIZES.map((paper) => (
                  <option
                    key={paper.label}
                    value={`${paper.size.width}x${paper.size.height}`}
                  >
                    {paper.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

interface ArrangeSectionProps {
  count: number;
  hasGroup: boolean;
  onReorder: (direction: "front" | "back" | "forward" | "backward") => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onGroup: () => void;
  onUngroup: () => void;
  onSaveStamp: () => void;
}

function ArrangeSection({
  count,
  hasGroup,
  onReorder,
  onAlign,
  onDistribute,
  onGroup,
  onUngroup,
  onSaveStamp,
}: ArrangeSectionProps) {
  const alignments: { mode: AlignMode; label: string }[] = [
    { mode: "left", label: "左揃え" },
    { mode: "hcenter", label: "左右中央" },
    { mode: "right", label: "右揃え" },
    { mode: "top", label: "上揃え" },
    { mode: "vcenter", label: "上下中央" },
    { mode: "bottom", label: "下揃え" },
  ];

  return (
    <section className="space-y-3">
      <Field label="重なり順">
        <div className="grid grid-cols-4 gap-1">
          <TinyButton label="最前面へ" onClick={() => onReorder("front")}>
            <BringForwardIcon className="h-4 w-4" />
          </TinyButton>
          <TinyButton label="前面へ" onClick={() => onReorder("forward")}>
            <span className="text-[11px] font-semibold">+1</span>
          </TinyButton>
          <TinyButton label="背面へ" onClick={() => onReorder("backward")}>
            <span className="text-[11px] font-semibold">-1</span>
          </TinyButton>
          <TinyButton label="最背面へ" onClick={() => onReorder("back")}>
            <SendBackwardIcon className="h-4 w-4" />
          </TinyButton>
        </div>
      </Field>

      {count > 1 && (
        <>
          <Field label="整列">
            <div className="grid grid-cols-6 gap-1">
              {alignments.map(({ mode, label }) => (
                <TinyButton
                  key={mode}
                  label={label}
                  onClick={() => onAlign(mode)}
                >
                  <AlignGlyph mode={mode} />
                </TinyButton>
              ))}
            </div>
          </Field>

          {count > 2 && (
            <Field label="等間隔に配置">
              <div className="grid grid-cols-2 gap-1">
                <TinyButton
                  label="左右に等間隔"
                  onClick={() => onDistribute("horizontal")}
                >
                  <span className="text-[11px]">横</span>
                </TinyButton>
                <TinyButton
                  label="上下に等間隔"
                  onClick={() => onDistribute("vertical")}
                >
                  <span className="text-[11px]">縦</span>
                </TinyButton>
              </div>
            </Field>
          )}
        </>
      )}

      <div className="flex gap-1">
        {count > 1 && (
          <TinyButton label="グループ化 (Cmd/Ctrl+G)" onClick={onGroup} wide>
            <GroupIcon className="h-4 w-4" />
          </TinyButton>
        )}
        {hasGroup && (
          <TinyButton
            label="グループ解除 (Cmd/Ctrl+Shift+G)"
            onClick={onUngroup}
            wide
          >
            <UngroupIcon className="h-4 w-4" />
          </TinyButton>
        )}
        <TinyButton label="スタンプとして保存" onClick={onSaveStamp} wide>
          <StampIcon className="h-4 w-4" />
        </TinyButton>
      </div>
    </section>
  );
}

/** 整列ボタンの中の簡単な図。 */
function AlignGlyph({ mode }: { mode: AlignMode }) {
  const horizontal = mode === "left" || mode === "hcenter" || mode === "right";
  const position =
    mode === "left" || mode === "top"
      ? "start"
      : mode === "right" || mode === "bottom"
        ? "end"
        : "center";

  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 ${horizontal ? "flex-col" : "flex-row"} items-${position} justify-center gap-0.5`}
    >
      <span
        className={`bg-current ${horizontal ? "h-1 w-3.5" : "h-3.5 w-1"} rounded-sm`}
      />
      <span
        className={`bg-current ${horizontal ? "h-1 w-2" : "h-2 w-1"} rounded-sm`}
      />
    </span>
  );
}

interface SectionProps<T extends EditorElement> {
  element: T;
  recent: string[];
  onPreview: (patch: Partial<EditorElement>) => void;
  onCommit: (patch: Partial<EditorElement>) => void;
  onBeginTransaction: () => void;
  onEndTransaction: () => void;
}

function TextSection({
  element,
  recent,
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

      <Field label="書式">
        <div className="flex items-center gap-1">
          <ToggleButton
            label="太字"
            active={element.fontWeight === "bold"}
            onClick={() =>
              onCommit({
                fontWeight: element.fontWeight === "bold" ? "regular" : "bold",
              })
            }
          >
            <BoldIcon className="h-4 w-4" />
          </ToggleButton>
          <ToggleButton
            label="斜体"
            active={element.italic}
            onClick={() => onCommit({ italic: !element.italic })}
          >
            <ItalicIcon className="h-4 w-4" />
          </ToggleButton>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {alignments.map(({ value, label, Icon }) => (
            <ToggleButton
              key={value}
              label={label}
              active={element.align === value}
              onClick={() => onCommit({ align: value })}
            >
              <Icon className="h-4 w-4" />
            </ToggleButton>
          ))}
        </div>
      </Field>

      <Field label="日本語組版">
        <div className="flex items-center gap-1">
          <ToggleButton
            label="縦書き"
            active={element.vertical}
            onClick={() => onCommit({ vertical: !element.vertical })}
          >
            <span className="text-[11px] font-semibold">縦</span>
          </ToggleButton>
          <ToggleButton
            label="ぶら下げ組"
            active={element.hanging}
            onClick={() => onCommit({ hanging: !element.hanging })}
          >
            <span className="text-[11px] font-semibold">ぶ</span>
          </ToggleButton>
          <span className="ml-1 text-[11px] text-slate-400">
            句読点は自動で詰まります
          </span>
        </div>
      </Field>

      <Field label="折り返し">
        <div className="flex items-center gap-2">
          <ToggleButton
            label={
              element.width === null
                ? "折り返しを有効にする"
                : "折り返しをやめる"
            }
            active={element.width !== null}
            onClick={() => onCommit({ width: element.width === null ? 0.4 : null })}
          >
            <WrapIcon className="h-4 w-4" />
          </ToggleButton>
          {element.width !== null && (
            <input
              type="range"
              min={5}
              max={100}
              step={1}
              value={Math.round(element.width * 100)}
              onPointerDown={onBeginTransaction}
              onChange={(event) =>
                onPreview({ width: Number(event.target.value) / 100 })
              }
              onPointerUp={onEndTransaction}
              aria-label="折り返し幅"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
            />
          )}
        </div>
      </Field>

      <Field label="文字色">
        <Swatches
          colors={TEXT_COLORS}
          value={element.color}
          onPick={(color) => onCommit({ color })}
          recent={recent}
          allowCustom
          onCustomBegin={onBeginTransaction}
          onCustomChange={(color) => onPreview({ color })}
          onCustomEnd={onEndTransaction}
        />
      </Field>
    </>
  );
}

function CalloutSection({
  element,
  recent,
  onPreview,
  onCommit,
  onBeginTransaction,
  onEndTransaction,
}: SectionProps<CalloutElement>) {
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
          className="w-full resize-y rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-800 focus-visible:border-blue-500 focus-visible:outline-none"
        />
      </Field>

      <Field label={`フォントサイズ (${Math.round(element.fontSize)}pt)`}>
        <input
          type="range"
          min={MIN_FONT_SIZE}
          max={72}
          step={1}
          value={Math.round(element.fontSize)}
          onPointerDown={onBeginTransaction}
          onChange={(event) =>
            onPreview({ fontSize: Number(event.target.value) })
          }
          onPointerUp={onEndTransaction}
          aria-label="フォントサイズ"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
        />
      </Field>

      <Field label="文字色">
        <Swatches
          colors={TEXT_COLORS}
          value={element.color}
          onPick={(color) => onCommit({ color })}
          recent={recent}
        />
      </Field>

      <Field label="枠と線の色">
        <Swatches
          colors={TEXT_COLORS}
          value={element.stroke}
          onPick={(color) => onCommit({ stroke: color })}
          recent={recent}
          allowNone
          onPickNone={() => onCommit({ stroke: null })}
        />
      </Field>

      <Field label="枠の塗り">
        <Swatches
          colors={TEXT_COLORS}
          value={element.fill}
          onPick={(color) => onCommit({ fill: color })}
          recent={recent}
          allowNone
          onPickNone={() => onCommit({ fill: null })}
        />
      </Field>

      <StrokeWidthField
        value={element.strokeWidth}
        onPreview={(strokeWidth) => onPreview({ strokeWidth })}
        onBeginTransaction={onBeginTransaction}
        onEndTransaction={onEndTransaction}
      />
    </>
  );
}

function ShapeSection({
  element,
  recent,
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
          recent={recent}
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
          recent={recent}
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
  recent,
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
          recent={recent}
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

      {element.type === "pen" && element.pressure && (
        <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
          筆圧を反映して描かれています。
        </p>
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
  /** 直近に使った色。 */
  recent?: string[];
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
  recent = [],
}: SwatchesProps) {
  // ページ上の色をそのまま拾える環境ではスポイトを出す。
  const canPickFromScreen =
    typeof window !== "undefined" && "EyeDropper" in window;

  const pickFromScreen = async () => {
    try {
      const Picker = (
        window as unknown as {
          EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> };
        }
      ).EyeDropper;
      const result = await new Picker().open();
      onPick(result.sRGBHex);
    } catch {
      // 取り消しただけなので何もしない。
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {canPickFromScreen && (
        <button
          type="button"
          onClick={() => void pickFromScreen()}
          title="画面から色を拾う"
          aria-label="画面から色を拾う"
          className="grid h-7 w-7 shrink-0 place-items-center rounded border border-slate-300 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          <PipetteIcon className="h-4 w-4" />
        </button>
      )}
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
            value === null
              ? "border-blue-500 ring-2 ring-blue-500/30"
              : "border-slate-300"
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

      {recent.length > 0 && (
        <>
          <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
          {recent.slice(0, 5).map((color) => (
            <button
              key={`recent-${color}`}
              type="button"
              onClick={() => onPick(color)}
              title={`最近使った色 ${color}`}
              aria-label={`最近使った色 ${color} にする`}
              className="h-6 w-6 rounded border border-slate-300 transition-transform hover:scale-110"
              style={{ backgroundColor: color }}
            />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * 正規化された値を、選んだ単位で見せる入力欄。
 * 内部の持ち方は比率のまま変えない。
 */
function LengthInput({
  id,
  value,
  total,
  unit,
  onCommit,
  disabled,
}: {
  id: string;
  value: number;
  /** ページの該当方向の長さ（PDFポイント）。 */
  total: number;
  unit: Unit;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="number"
      step={unit === "percent" ? 0.1 : unit === "mm" ? 0.5 : 1}
      disabled={disabled}
      value={formatLength(value, total, unit)}
      onChange={(event) =>
        onCommit(
          clamp(parseLength(Number(event.target.value), total, unit), -1, 2),
        )
      }
      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums text-slate-800 focus-visible:border-blue-500 focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-400"
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
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
        active
          ? "bg-slate-900 text-white"
          : danger
            ? "text-slate-500 hover:bg-red-50 hover:text-red-600"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-7 w-8 place-items-center rounded-md border transition-colors ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 text-slate-500 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function TinyButton({
  label,
  onClick,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-7 place-items-center rounded-md border border-slate-300 text-slate-600 transition-colors hover:bg-slate-100 ${
        wide ? "flex-1" : ""
      }`}
    >
      {children}
    </button>
  );
}

function SmallButton({
  onClick,
  disabled,
  danger,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-300 disabled:hover:bg-transparent ${
        danger
          ? "hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          : "hover:bg-slate-50"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
