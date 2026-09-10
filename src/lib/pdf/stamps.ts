import { createId } from "./elementDefaults";
import type { EditorElement, NormalizedRect } from "@/types/editor";

/**
 * サイン・スタンプの保存
 * ------------------------------------------------------------------
 * フリーハンドで書いたサインや、よく使う図形の組み合わせを登録しておき、
 * ワンクリックで別のページや別の文書に置けるようにする。
 *
 * 保存するのは要素そのもの（正規化座標）。置くときに指定した矩形へ
 * 合わせて拡大縮小するので、ページの大きさが違っても崩れない。
 */

const STORAGE_KEY = "pdf-editor:stamps";
const MAX_STAMPS = 24;

export interface SavedStamp {
  id: string;
  label: string;
  createdAt: number;
  /** 元の縦横比。置くときの高さを決めるのに使う。 */
  aspect: number;
  /** 0〜1 の正規化座標へ収め直した要素。 */
  elements: EditorElement[];
}

export function loadStamps(): SavedStamp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedStamp[]) : [];
  } catch {
    return [];
  }
}

function persist(stamps: SavedStamp[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamps.slice(0, MAX_STAMPS)));
  } catch {
    // 容量超過などで保存できなくても、その場の編集は続けられる。
  }
}

/**
 * 選択中の要素をスタンプとして登録する。
 * 元の位置に関係なく使い回せるよう、外接矩形が 0〜1 に収まるよう正規化する。
 */
export function createStamp(
  label: string,
  elements: EditorElement[],
  bounds: NormalizedRect,
  view: { width: number; height: number },
): SavedStamp {
  const scaleX = bounds.w > 0 ? 1 / bounds.w : 1;
  const scaleY = bounds.h > 0 ? 1 / bounds.h : 1;

  const mapped = elements.map((element) =>
    mapElement(element, (x, y) => ({
      x: (x - bounds.x) * scaleX,
      y: (y - bounds.y) * scaleY,
    })),
  );

  return {
    id: createId("stamp"),
    label,
    createdAt: Date.now(),
    aspect: (bounds.w * view.width) / Math.max(1e-6, bounds.h * view.height),
    elements: mapped,
  };
}

export function saveStamp(stamp: SavedStamp): SavedStamp[] {
  const next = [stamp, ...loadStamps().filter((item) => item.id !== stamp.id)];
  persist(next);
  return next.slice(0, MAX_STAMPS);
}

export function deleteStamp(id: string): SavedStamp[] {
  const next = loadStamps().filter((stamp) => stamp.id !== id);
  persist(next);
  return next;
}

/** スタンプを指定の矩形へ収まるよう展開する。 */
export function instantiateStamp(
  stamp: SavedStamp,
  pageIndex: number,
  target: NormalizedRect,
): EditorElement[] {
  return stamp.elements.map((element) => {
    const moved = mapElement(element, (x, y) => ({
      x: target.x + x * target.w,
      y: target.y + y * target.h,
    }));
    return {
      ...moved,
      id: createId(moved.type),
      pageIndex,
      // グループとして扱えるよう、まとめて新しい groupId を振る。
      groupId: moved.groupId === null ? null : moved.groupId,
    };
  });
}

/** 要素内のすべての座標へ写像を適用する。 */
function mapElement(
  element: EditorElement,
  map: (x: number, y: number) => { x: number; y: number },
): EditorElement {
  if (element.type === "arrow") {
    const start = map(element.x1, element.y1);
    const end = map(element.x2, element.y2);
    return { ...element, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  if (element.type === "pen") {
    return {
      ...element,
      points: element.points.map((point) => ({
        ...point,
        ...map(point.x, point.y),
      })),
    };
  }

  if (element.type === "text") {
    const origin = map(element.x, element.y);
    return { ...element, x: origin.x, y: origin.y };
  }

  const origin = map(element.x, element.y);
  const far = map(element.x + element.w, element.y + element.h);
  return {
    ...element,
    x: origin.x,
    y: origin.y,
    w: Math.abs(far.x - origin.x),
    h: Math.abs(far.y - origin.y),
  };
}
