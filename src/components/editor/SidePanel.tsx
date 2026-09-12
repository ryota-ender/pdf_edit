"use client";

import { CommentIcon, FormIcon, LayersIcon, SlidersIcon } from "./Icons";

export type PanelTab = "properties" | "layers" | "comments" | "form";

interface SidePanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** コメント件数・入力欄数などのバッジ。 */
  counts: { layers: number; comments: number; form: number };
  /** 狭い画面では本文に重ねて出す。 */
  floating?: boolean;
  children: React.ReactNode;
}

const TABS: { id: PanelTab; label: string; Icon: (p: { className?: string }) => React.ReactElement }[] = [
  { id: "properties", label: "プロパティ", Icon: SlidersIcon },
  { id: "layers", label: "レイヤー", Icon: LayersIcon },
  { id: "comments", label: "コメント", Icon: CommentIcon },
  { id: "form", label: "フォーム", Icon: FormIcon },
];

/**
 * 右側のパネル。
 *
 * プロパティ・レイヤー・コメント・フォームを 1 か所にまとめ、
 * タブで切り替える。画面が狭いときは呼び出し側で閉じられる。
 */
export function SidePanel({
  tab,
  onTabChange,
  counts,
  floating = false,
  children,
}: SidePanelProps) {
  return (
    <aside
      className={`flex w-72 flex-col border-l border-slate-200 bg-white ${
        floating
          ? "absolute inset-y-0 right-0 z-20 shadow-2xl"
          : "shrink-0"
      }`}
    >
      <div
        role="tablist"
        aria-label="パネル"
        className="flex shrink-0 border-b border-slate-200"
      >
        {TABS.map(({ id, label, Icon }) => {
          const badge =
            id === "layers"
              ? counts.layers
              : id === "comments"
                ? counts.comments
                : id === "form"
                  ? counts.form
                  : 0;

          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-label={label}
              title={label}
              onClick={() => onTabChange(id)}
              className={`relative flex flex-1 items-center justify-center gap-1 py-2 text-[11px] transition-colors ${
                tab === id
                  ? "border-b-2 border-blue-600 font-medium text-blue-700"
                  : "border-b-2 border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {badge > 0 && (
                <span className="rounded-full bg-slate-200 px-1 text-[9px] font-medium text-slate-700">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-4 py-4">
        {children}
      </div>
    </aside>
  );
}
