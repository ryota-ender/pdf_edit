"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageThumbnail } from "./PageThumbnail";
import type { PageSize, PageState } from "@/types/editor";

interface PageSidebarProps {
  doc: PDFDocumentProxy;
  pages: PageState[];
  /** 元 PDF のページ寸法（sourceIndex で引く）。 */
  sizes: PageSize[];
  /** 元 PDF のページ回転（sourceIndex で引く）。 */
  baseRotations: number[];
  currentPage: number;
  onSelectPage: (index: number) => void;
  onRotatePage: (index: number) => void;
  onDeletePage: (index: number) => void;
  /** 各ページに載っている編集要素の数。 */
  elementCounts: number[];
}

export function PageSidebar({
  doc,
  pages,
  sizes,
  baseRotations,
  currentPage,
  onSelectPage,
  onRotatePage,
  onDeletePage,
  elementCounts,
}: PageSidebarProps) {
  return (
    <aside className="hidden w-[188px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 md:flex">
      <div className="flex h-9 shrink-0 items-center px-3 text-xs font-semibold tracking-wide text-slate-500">
        ページ
      </div>

      <div
        data-thumbnail-scroll
        className="thin-scrollbar flex-1 space-y-2 overflow-y-auto px-3 pb-4"
      >
        {pages.map((page, index) => {
          const isActive = index === currentPage;
          return (
            <div key={`${page.sourceIndex}-${index}`} className="group relative">
              <button
                type="button"
                onClick={() => onSelectPage(index)}
                aria-current={isActive ? "page" : undefined}
                className={`block w-full overflow-hidden rounded-md border-2 bg-white transition-colors ${
                  isActive
                    ? "border-blue-500 shadow-sm"
                    : "border-transparent hover:border-slate-300"
                }`}
              >
                <span className="sr-only">{index + 1}ページ目を表示</span>
                <PageThumbnail
                  doc={doc}
                  sourceIndex={page.sourceIndex}
                  size={sizes[page.sourceIndex]}
                  rotation={baseRotations[page.sourceIndex] + page.rotation}
                />
              </button>

              <div className="mt-1 flex items-center justify-between px-0.5">
                <span
                  className={`text-xs tabular-nums ${
                    isActive ? "font-semibold text-blue-600" : "text-slate-500"
                  }`}
                >
                  {index + 1}
                  {elementCounts[index] > 0 && (
                    <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600">
                      {elementCounts[index]}
                    </span>
                  )}
                </span>

                <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <MiniButton
                    label={`${index + 1}ページ目を回転`}
                    onClick={() => onRotatePage(index)}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"
                    />
                  </MiniButton>
                  <MiniButton
                    label={`${index + 1}ページ目を削除`}
                    onClick={() => onDeletePage(index)}
                    disabled={pages.length <= 1}
                    danger
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 7h14M10 7V5h4v2m-7 0 .7 12h8.6L17 7"
                    />
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
      className={`rounded p-1 transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${
        danger
          ? "text-slate-500 hover:bg-red-50 hover:text-red-600"
          : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        className="h-3.5 w-3.5"
      >
        {children}
      </svg>
    </button>
  );
}
