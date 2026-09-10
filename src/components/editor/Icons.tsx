import type { SVGProps } from "react";

/**
 * ツールバーで使うアイコン。線幅と viewBox を揃えて、並べたときに
 * 大きさや太さがちぐはぐに見えないようにしている。
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CursorIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 3 6.5 16 2.2-6.3 6.3-2.2z" />
  </Icon>
);

export const TextIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />
  </Icon>
);

export const HighlightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m14.5 4.5 5 5-8 8H7l-1.5-3z" />
    <path d="M4 21h16" strokeWidth={2} />
  </Icon>
);

export const SquareIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={4} y={5} width={16} height={14} rx={1.5} />
  </Icon>
);

export const CircleIcon = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx={12} cy={12} rx={8} ry={7} />
  </Icon>
);

export const ArrowIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 19 19 5M11 5h8v8" />
  </Icon>
);

export const PenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20c1.5-6 4-11 6-11s.5 6 2 6 3-4 5-4 2.5 2 3 3" />
  </Icon>
);

export const ImageIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={3} y={5} width={18} height={14} rx={2} />
    <circle cx={8.5} cy={10} r={1.5} />
    <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
  </Icon>
);

export const UndoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 14 4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3" />
  </Icon>
);

export const RedoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m15 14 5-5-5-5m5 5h-9a6 6 0 0 0 0 12h3" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m15 5-7 7 7 7" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

export const ChevronUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 15 7-7 7 7" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 9 7 7 7-7" />
  </Icon>
);

export const RotateIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 7h14M10 7V5h4v2m-7 0 .7 12h8.6L17 7" />
  </Icon>
);

export const DuplicateIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={8} y={8} width={12} height={12} rx={2} />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v11m0 0 4-4m-4 4-4-4M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
  </Icon>
);

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);

export const PanelIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={3} y={4} width={18} height={16} rx={2} />
    <path d="M9 4v16" />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const AlignLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h16M4 12h10M4 18h13" />
  </Icon>
);

export const AlignCenterIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h16M7 12h10M5.5 18h13" />
  </Icon>
);

export const AlignRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h16M10 12h10M7 18h13" />
  </Icon>
);

export const UploadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 16.5V4.5m0 0L7.5 9M12 4.5 16.5 9M3.75 15.75v2.25a2.25 2.25 0 0 0 2.25 2.25h12a2.25 2.25 0 0 0 2.25-2.25v-2.25" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={5} y={11} width={14} height={9} rx={2} />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const UnlockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={5} y={11} width={14} height={9} rx={2} />
    <path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </Icon>
);

export const BoldIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7zM7 12h6a3.5 3.5 0 0 1 0 7H7z" />
  </Icon>
);

export const ItalicIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 5h-5M14 19H9M13 5l-2 14" />
  </Icon>
);

export const WrapIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h16M4 12h11a3 3 0 0 1 0 6h-3M4 18h3m0 0-2-2m2 2-2 2" />
  </Icon>
);

export const BringForwardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={4} y={4} width={11} height={11} rx={2} />
    <path d="M9 20h9a2 2 0 0 0 2-2V9" />
  </Icon>
);

export const SendBackwardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={9} y={9} width={11} height={11} rx={2} />
    <path d="M15 4H6a2 2 0 0 0-2 2v9" />
  </Icon>
);

export const GroupIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={4} y={4} width={7} height={7} rx={1} />
    <rect x={13} y={13} width={7} height={7} rx={1} />
    <path d="M13 7h4M7 13v4" />
  </Icon>
);

export const UngroupIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x={3} y={3} width={7} height={7} rx={1} />
    <rect x={14} y={14} width={7} height={7} rx={1} />
    <path d="m11 8 4-4m-4 0 4 4" strokeWidth={1.3} />
  </Icon>
);

export const StampIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 10V7a3 3 0 0 1 6 0v3M5 14h14v3H5zM7 14l1-4h8l1 4M4 20h16" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx={11} cy={11} r={6} />
    <path d="m20 20-4.5-4.5" />
  </Icon>
);

export const TextCursorIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 5h4M12 5v14M10 19h4M6 8V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" />
  </Icon>
);

export const MergeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4v5a4 4 0 0 0 4 4h6M19 4v5a4 4 0 0 1-4 4M12 13v7m0 0-3-3m3 3 3-3" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
