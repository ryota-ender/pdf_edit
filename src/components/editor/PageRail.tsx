"use client";

import { useState } from "react";
import { PageThumbnail } from "./PageThumbnail";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DuplicateIcon,
  RotateIcon,
  TrashIcon,
} from "./Icons";
import type { LoadedSource } from "@/hooks/usePdfDocument";
import type { PageState } from "@/types/editor";

export interface PageViewInfo {
  /** 白紙ページでは null。 */
  source: LoadedSource | null;
  rotation: number;
  width: number;
  height: number;
}

interface PageRailProps {
  pages: PageState[];
  /** 各ページの元ファイル・最終回転角・表示寸法。 */
  pageViews: (PageViewInfo | null)[];
  currentPage: number;
  onSelectPage: (index: number) => void;
  onRotatePage: (index: number) => void;
  onDeletePage: (index: number) => void;
  onDuplicatePage: (index: number) => void;
  onMovePage: (index: number, direction: -1 | 1) => void;
  onReorderPages: (from: number, to: number) => void;
  /** 各ページに載っている編集要素の数。 */
  elementCounts: number[];
}

/**
 * 左側のページ一覧。
 * クリックでそのページへ飛び、ドラッグで並べ替えられる。
 */
export function PageRail({
  pages,
  pageViews,
  currentPage,
  onSelectPage,
  onRotatePage,
  onDeletePage,
  onDuplicatePage,
  onMovePage,
  onReorderPages,
  elementCounts,
}: PageRailProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-semibold tracking-wide text-slate-500">
          ページ
        </span>
        <span className="text-xs tabular-nums text-slate-400">{pages.length}</span>
      </div>

      <div
        data-thumbnail-scroll
        className="thin-scrollbar flex-1 space-y-1 overflow-y-auto px-2 pb-4"
      >
        {pages.map((page, index) => {
          const isActive = index === currentPage;
          const view = pageViews[index];
          const isDropTarget = dropIndex === index && draggingIndex !== index;

          return (
            <div
              key={`${page.sourceId}-${page.sourceIndex}-${index}`}
              draggable
              onDragStart={(event) => {
                setDraggingIndex(index);
                event.dataTransfer.effectAllowed = "move";
                // Firefox はデータが空だとドラッグを開始しない。
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropIndex(index);
              }}
              onDragLeave={() => {
                setDropIndex((current) => (current === index ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingIndex !== null && draggingIndex !== index) {
                  onReorderPages(draggingIndex, index);
                }
                setDraggingIndex(null);
                setDropIndex(null);
              }}
              onDragEnd={() => {
                setDraggingIndex(null);
                setDropIndex(null);
              }}
              className={`group rounded-lg p-1.5 transition-colors ${
                isActive ? "bg-blue-50" : "hover:bg-slate-100"
              } ${draggingIndex === index ? "opacity-40" : ""} ${
                isDropTarget ? "ring-2 ring-blue-400" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectPage(index)}
                aria-current={isActive ? "page" : undefined}
                className={`block w-full overflow-hidden rounded-md border-2 bg-white transition-colors ${
                  isActive
                    ? "border-blue-500 shadow-sm"
                    : "border-slate-200 group-hover:border-slate-300"
                }`}
              >
                <span className="sr-only">{index + 1}ページ目を表示</span>
                {view?.source ? (
                  <PageThumbnail
                    doc={view.source.doc}
                    sourceIndex={page.sourceIndex}
                    size={view.source.sizes[page.sourceIndex]}
                    rotation={view.rotation}
                  />
                ) : (
                  // 白紙ページ。縦横比だけ合わせた白い矩形を出す。
                  <div
                    className="bg-white"
                    style={{
                      width: 132,
                      height: view
                        ? Math.round((132 * view.height) / view.width)
                        : 186,
                    }}
                  />
                )}
              </button>

              <div className="mt-1 flex items-center justify-between gap-1 px-0.5">
                <span
                  className={`flex items-center gap-1 text-xs tabular-nums ${
                    isActive ? "font-semibold text-blue-600" : "text-slate-500"
                  }`}
                >
                  {index + 1}
                  {elementCounts[index] > 0 && (
                    <span
                      title={`編集要素 ${elementCounts[index]} 個`}
                      className="rounded-full bg-blue-100 px-1.5 text-[10px] font-medium text-blue-700"
                    >
                      {elementCounts[index]}
                    </span>
                  )}
                </span>

                <span className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <MiniButton
                    label={`${index + 1}ページ目を上へ`}
                    onClick={() => onMovePage(index, -1)}
                    disabled={index === 0}
                  >
                    <ChevronUpIcon className="h-3.5 w-3.5" />
                  </MiniButton>
                  <MiniButton
                    label={`${index + 1}ページ目を下へ`}
                    onClick={() => onMovePage(index, 1)}
                    disabled={index === pages.length - 1}
                  >
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </MiniButton>
                  <MiniButton
                    label={`${index + 1}ページ目を回転`}
                    onClick={() => onRotatePage(index)}
                  >
                    <RotateIcon className="h-3.5 w-3.5" />
                  </MiniButton>
                  <MiniButton
                    label={`${index + 1}ページ目を複製`}
                    onClick={() => onDuplicatePage(index)}
                  >
                    <DuplicateIcon className="h-3.5 w-3.5" />
                  </MiniButton>
                  <MiniButton
                    label={`${index + 1}ページ目を削除`}
                    onClick={() => onDeletePage(index)}
                    disabled={pages.length <= 1}
                    danger
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </MiniButton>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

interface MiniButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}

function MiniButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: MiniButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded p-0.5 transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${
        danger
          ? "text-slate-500 hover:bg-red-100 hover:text-red-600"
          : "text-slate-500 hover:bg-slate-200 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
