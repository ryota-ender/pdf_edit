"use client";

import { ELEMENT_LABELS } from "@/lib/pdf/elementDefaults";
import { EyeIcon, EyeOffIcon, LockIcon, TrashIcon, UnlockIcon } from "./Icons";
import type { EditorElement } from "@/types/editor";

interface LayersPanelProps {
  /** 表示中のページの要素（重なり順）。 */
  elements: EditorElement[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}

/**
 * ページ上の要素の一覧。
 *
 * 注釈が増えるとキャンバスだけでは目的のものに辿り着けないので、
 * 一覧から選ぶ・並べ替える・隠す・ロックする手段を用意する。
 * 並びは重なり順そのもの。手前にあるものを上に出す。
 */
export function LayersPanel({
  elements,
  selectedIds,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onDelete,
  onReorder,
}: LayersPanelProps) {
  if (elements.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
        このページにはまだ
        <br />
        編集要素がありません。
      </p>
    );
  }

  // 手前のものを上に出したいので、配列を逆順で並べる。
  const rows = elements.map((element, index) => ({ element, index })).reverse();

  return (
    <ul className="space-y-0.5">
      {rows.map(({ element, index }) => {
        const isSelected = selectedIds.includes(element.id);
        return (
          <li
            key={element.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = Number(event.dataTransfer.getData("text/plain"));
              if (!Number.isNaN(from) && from !== index) onReorder(from, index);
            }}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
              isSelected ? "bg-blue-50" : "hover:bg-slate-50"
            }`}
          >
            <button
              type="button"
              onClick={(event) =>
                onSelect(
                  event.shiftKey
                    ? isSelected
                      ? selectedIds.filter((id) => id !== element.id)
                      : [...selectedIds, element.id]
                    : [element.id],
                )
              }
              className="min-w-0 flex-1 truncate text-left text-xs"
              title={describe(element)}
            >
              <span
                className={
                  isSelected ? "font-medium text-blue-700" : "text-slate-700"
                }
              >
                {describe(element)}
              </span>
            </button>

            <MiniToggle
              label={element.visible ? "隠す" : "表示する"}
              onClick={() => onToggleVisible(element.id)}
              muted={!element.visible}
            >
              {element.visible ? (
                <EyeIcon className="h-3.5 w-3.5" />
              ) : (
                <EyeOffIcon className="h-3.5 w-3.5" />
              )}
            </MiniToggle>

            <MiniToggle
              label={element.locked ? "ロックを解除" : "ロック"}
              onClick={() => onToggleLock(element.id)}
              muted={element.locked}
            >
              {element.locked ? (
                <LockIcon className="h-3.5 w-3.5" />
              ) : (
                <UnlockIcon className="h-3.5 w-3.5" />
              )}
            </MiniToggle>

            <MiniToggle
              label="削除"
              onClick={() => onDelete(element.id)}
              danger
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </MiniToggle>
          </li>
        );
      })}
    </ul>
  );
}

/** 一覧に出す名前。文字を持つ要素は中身を少し見せる。 */
function describe(element: EditorElement): string {
  if (element.name) return element.name;

  const label = ELEMENT_LABELS[element.type];
  if (element.type === "text" || element.type === "callout") {
    const preview = element.text.replace(/\n/g, " ").trim().slice(0, 18);
    return preview.length > 0 ? `${label}: ${preview}` : label;
  }
  return label;
}

function MiniToggle({
  label,
  onClick,
  muted,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  muted?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`shrink-0 rounded p-1 transition-colors ${
        danger
          ? "text-slate-400 hover:bg-red-50 hover:text-red-600"
          : muted
            ? "text-slate-300 hover:bg-slate-100 hover:text-slate-600"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
