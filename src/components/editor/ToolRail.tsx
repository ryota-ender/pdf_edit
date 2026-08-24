"use client";

import {
  ArrowIcon,
  CircleIcon,
  CursorIcon,
  HighlightIcon,
  ImageIcon,
  PenIcon,
  SquareIcon,
  TextIcon,
} from "./Icons";
import type { ToolId } from "@/types/editor";

interface ToolDefinition {
  id: ToolId;
  label: string;
  shortcut: string;
  Icon: (props: { className?: string }) => React.ReactElement;
}

const TOOLS: ToolDefinition[] = [
  { id: "select", label: "選択", shortcut: "V", Icon: CursorIcon },
  { id: "text", label: "テキスト", shortcut: "T", Icon: TextIcon },
  { id: "highlight", label: "ハイライト", shortcut: "H", Icon: HighlightIcon },
  { id: "pen", label: "フリーハンド", shortcut: "P", Icon: PenIcon },
  { id: "rect", label: "四角形", shortcut: "R", Icon: SquareIcon },
  { id: "ellipse", label: "円", shortcut: "O", Icon: CircleIcon },
  { id: "arrow", label: "矢印", shortcut: "A", Icon: ArrowIcon },
  { id: "image", label: "画像", shortcut: "I", Icon: ImageIcon },
];

interface ToolRailProps {
  tool: ToolId;
  onSelect: (tool: ToolId) => void;
}

/** 左端の縦型ツールバー。 */
export function ToolRail({ tool, onSelect }: ToolRailProps) {
  return (
    <nav
      aria-label="ツール"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3"
    >
      {TOOLS.map(({ id, label, shortcut, Icon }, index) => (
        <div key={id} className="contents">
          {index === 2 && <Separator />}
          <button
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={tool === id}
            aria-label={label}
            title={`${label} (${shortcut})`}
            className={`group relative grid h-10 w-10 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              tool === id
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="pointer-events-none absolute left-full z-30 ml-2 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white group-hover:block">
              {label}
              <span className="ml-1.5 text-slate-400">{shortcut}</span>
            </span>
          </button>
        </div>
      ))}
    </nav>
  );
}

function Separator() {
  return <span className="my-1 h-px w-7 bg-slate-200" aria-hidden="true" />;
}
