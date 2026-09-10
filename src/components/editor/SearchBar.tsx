"use client";

import { useEffect, useRef } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon,
} from "./Icons";

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  activeIndex: number;
  isSearching: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/** 文書内検索。ページをまたいでヒット箇所を巡る。 */
export function SearchBar({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  isSearching,
  onNext,
  onPrevious,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="absolute right-4 top-3 z-30 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
      <SearchIcon className="ml-1 h-4 w-4 shrink-0 text-slate-400" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="文書内を検索"
        aria-label="文書内を検索"
        className="w-48 bg-transparent px-1 py-1 text-sm text-slate-800 outline-none placeholder:text-slate-400"
      />

      <span className="min-w-16 px-1 text-center text-xs tabular-nums text-slate-500">
        {isSearching
          ? "検索中…"
          : matchCount === 0
            ? query.length > 0
              ? "0 件"
              : ""
            : `${activeIndex + 1} / ${matchCount}`}
      </span>

      <IconButton label="前の一致" onClick={onPrevious} disabled={matchCount === 0}>
        <ChevronUpIcon className="h-4 w-4" />
      </IconButton>
      <IconButton label="次の一致" onClick={onNext} disabled={matchCount === 0}>
        <ChevronDownIcon className="h-4 w-4" />
      </IconButton>
      <IconButton label="検索を閉じる" onClick={onClose}>
        <CloseIcon className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
