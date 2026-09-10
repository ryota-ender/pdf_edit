"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/pdf/textLayout";
import {
  applyResize,
  clampTranslation,
  computeSnap,
  elementBoundingRect,
  elementRect,
  normalizeRect,
  rectCenter,
  rectsIntersect,
  resizeRect,
  rotatePoint,
  translateElement,
  unionRect,
} from "@/lib/pdf/geometry";
import type { HandleId, SnapGuide } from "@/lib/pdf/geometry";
import {
  createDrawElement,
  createTextElement,
  isDegenerate,
  updateDrawElement,
} from "@/lib/pdf/elementDefaults";
import type { StyleDefaults } from "@/lib/pdf/elementDefaults";
import type { FontBook } from "@/lib/pdf/font";
import type {
  EditorElement,
  NormalizedRect,
  Point,
  ToolId,
} from "@/types/editor";
import { DRAW_TOOLS } from "@/types/editor";

/** ページ側から呼ぶ操作。状態は親（PdfEditor）が持つ。 */
export interface PageActions {
  beginTransaction: () => void;
  endTransaction: () => void;
  updateElements: (
    updater: (elements: EditorElement[]) => EditorElement[],
    transient: boolean,
  ) => void;
  addElement: (element: EditorElement, transient: boolean) => void;
  removeElement: (id: string) => void;
  setSelection: (ids: string[]) => void;
  /** 再レンダリング前でも最新の要素一覧を読むための入口。 */
  getElements: () => EditorElement[];
  startEditing: (id: string) => void;
  requestImage: (pageIndex: number, x: number, y: number) => void;
  /** 図形を描き終えたときに呼ぶ。ハイライトの行揃えなどに使う。 */
  onDrawComplete?: (element: EditorElement) => void;
  /** 既存テキストをなぞって編集するモードでの選択。 */
  onTextEditRequest?: (pageIndex: number, rect: NormalizedRect) => void;
}

export interface UsePageInteractionOptions {
  pageIndex: number;
  view: { width: number; height: number };
  cssPxPerPoint: number;
  /** このページの要素（重なり順）。 */
  elements: EditorElement[];
  selectedIds: string[];
  tool: ToolId;
  style: StyleDefaults;
  fonts: FontBook;
  actions: PageActions;
  svgRef: RefObject<SVGSVGElement | null>;
  /** スナップを有効にするか。 */
  snapEnabled: boolean;
}

type Interaction =
  | { kind: "idle" }
  | {
      kind: "marquee";
      pointerId: number;
      start: Point;
      additive: boolean;
      baseSelection: string[];
    }
  | {
      kind: "move";
      pointerId: number;
      start: Point;
      ids: string[];
      originals: Map<string, EditorElement>;
      unionBefore: NormalizedRect;
      others: NormalizedRect[];
    }
  | {
      kind: "resize";
      pointerId: number;
      handle: HandleId;
      id: string;
      original: EditorElement;
      rectBefore: NormalizedRect;
      centerBefore: Point;
      /** 掴んでいない側の固定点（回転を適用した世界座標）。 */
      anchorWorld: Point;
    }
  | {
      kind: "rotate";
      pointerId: number;
      id: string;
      original: EditorElement;
      center: Point;
      startAngle: number;
    }
  | {
      kind: "draw";
      pointerId: number;
      id: string;
      start: Point;
    }
  | {
      kind: "textEdit";
      pointerId: number;
      start: Point;
    };

/**
 * ページ上のポインタ操作をまとめて引き受ける。
 *
 * 描画・移動・リサイズ・回転・範囲選択・既存テキスト選択が、それぞれ
 * 「押す → 動かす → 離す」の 3 段階で完結するように書いてある。
 * 状態は ref に置き、描画に要るもの（範囲選択の枠・スナップ線）だけ
 * state で返す。
 */
export function usePageInteraction({
  pageIndex,
  view,
  cssPxPerPoint,
  elements,
  selectedIds,
  tool,
  style,
  fonts,
  actions,
  svgRef,
  snapEnabled,
}: UsePageInteractionOptions) {
  const interactionRef = useRef<Interaction>({ kind: "idle" });
  // ペンが一度でも使われたら、以後タッチは無視する（手のひら誤爆よけ）。
  const penSeenRef = useRef(false);

  const [marquee, setMarquee] = useState<NormalizedRect | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);

  const measureCtx = { view, fonts };

  const toNormalized = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    },
    [svgRef],
  );

  /** 手のひらでの誤描画を弾く。 */
  const shouldIgnorePointer = (event: React.PointerEvent): boolean => {
    if (event.pointerType === "pen") {
      penSeenRef.current = true;
      return false;
    }
    return penSeenRef.current && event.pointerType === "touch";
  };

  // --- 背景（＝ページの余白）を押したとき --------------------------
  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || shouldIgnorePointer(event)) return;
    const point = toNormalized(event);

    if (tool === "text") {
      // 既定のフォーカス移動を止める。これを許すと、直後に生成した
      // 入力欄からフォーカスが奪われて編集が即終了してしまう。
      event.preventDefault();
      const element = createTextElement(pageIndex, point.x, point.y, style);
      actions.addElement(element, false);
      actions.setSelection([element.id]);
      actions.startEditing(element.id);
      return;
    }

    if (tool === "image") {
      actions.requestImage(pageIndex, point.x, point.y);
      return;
    }

    if (tool === "textEdit") {
      event.preventDefault();
      interactionRef.current = {
        kind: "textEdit",
        pointerId: event.pointerId,
        start: point,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if ((DRAW_TOOLS as readonly string[]).includes(tool)) {
      event.preventDefault();
      const element = createDrawElement(
        tool as (typeof DRAW_TOOLS)[number],
        pageIndex,
        point.x,
        point.y,
        style,
        event.pointerType === "pen"
          ? { x: point.x, y: point.y, p: event.pressure || 0.5 }
          : undefined,
      );
      actions.beginTransaction();
      actions.addElement(element, true);
      actions.setSelection([]);
      interactionRef.current = {
        kind: "draw",
        pointerId: event.pointerId,
        id: element.id,
        start: point,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // 選択ツール: 範囲選択を始める。
    if (!event.shiftKey) actions.setSelection([]);
    interactionRef.current = {
      kind: "marquee",
      pointerId: event.pointerId,
      start: point,
      additive: event.shiftKey,
      baseSelection: event.shiftKey ? selectedIds : [],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // --- 要素を押したとき --------------------------------------------
  const onElementPointerDown = (
    event: React.PointerEvent,
    element: EditorElement,
  ) => {
    if (shouldIgnorePointer(event)) return;

    // 描画ツール中は要素の上からでも描き始められるようにする。
    if (tool !== "select") {
      onBackgroundPointerDown(event);
      return;
    }

    event.stopPropagation();
    if (event.button !== 0 || element.locked) return;

    // グループの一員なら、同じグループをまとめて掴む。
    const groupMates = element.groupId
      ? elements.filter((item) => item.groupId === element.groupId)
      : [element];
    const groupIds = groupMates.map((item) => item.id);

    const isSelected = selectedIds.includes(element.id);
    let nextSelection: string[];

    if (event.shiftKey) {
      nextSelection = isSelected
        ? selectedIds.filter((id) => !groupIds.includes(id))
        : [...selectedIds, ...groupIds];
    } else {
      nextSelection = isSelected ? selectedIds : groupIds;
    }
    actions.setSelection(nextSelection);

    // Shift クリックで選択を外した要素は動かさない。
    if (event.shiftKey && isSelected) return;

    const point = toNormalized(event);
    const moving = elements.filter(
      (item) => nextSelection.includes(item.id) && !item.locked,
    );
    if (moving.length === 0) return;

    const originals = new Map(moving.map((item) => [item.id, item]));
    const union = unionRect(
      moving.map((item) => elementBoundingRect(item, measureCtx)),
    );
    if (!union) return;

    actions.beginTransaction();
    interactionRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      start: point,
      ids: [...originals.keys()],
      originals,
      unionBefore: union,
      // スナップ相手は「動かしていない要素」だけ。
      others: elements
        .filter((item) => !originals.has(item.id))
        .map((item) => elementBoundingRect(item, measureCtx)),
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  // --- ハンドルを押したとき ----------------------------------------
  const onHandlePointerDown = (
    handle: HandleId,
    event: React.PointerEvent<SVGElement>,
  ) => {
    event.stopPropagation();
    if (event.button !== 0 || selectedIds.length !== 1) return;

    const element = elements.find((item) => item.id === selectedIds[0]);
    if (!element || element.locked) return;

    const rect = elementRect(element, measureCtx);
    const center = rectCenter(rect);
    const point = toNormalized(event);

    actions.beginTransaction();

    if (handle === "rotate") {
      interactionRef.current = {
        kind: "rotate",
        pointerId: event.pointerId,
        id: element.id,
        original: element,
        center,
        startAngle: angleBetween(center, point, view),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // 掴んでいない側の角を、回転を適用した世界座標で覚えておく。
    // リサイズ中はこの点が動かないようにする。
    const anchorLocal = oppositeCorner(handle, rect);
    interactionRef.current = {
      kind: "resize",
      pointerId: event.pointerId,
      handle,
      id: element.id,
      original: element,
      rectBefore: rect,
      centerBefore: center,
      anchorWorld: rotatePoint(anchorLocal, center, element.rotation, view),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // --- 動かしている間 ----------------------------------------------
  const onPointerMove = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    if (interaction.kind === "idle") return;
    if (interaction.pointerId !== event.pointerId) return;

    const point = toNormalized(event);

    switch (interaction.kind) {
      case "marquee":
      case "textEdit": {
        setMarquee(
          normalizeRect(
            interaction.start.x,
            interaction.start.y,
            point.x,
            point.y,
          ),
        );
        break;
      }

      case "move": {
        let dx = point.x - interaction.start.x;
        let dy = point.y - interaction.start.y;

        // Shift で水平・垂直移動に固定する。
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }

        const clamped = clampTranslation(interaction.unionBefore, dx, dy);
        dx = clamped.dx;
        dy = clamped.dy;

        // 他の要素やページの基準線へ吸着させる。Alt で一時的に無効。
        if (snapEnabled && !event.altKey && !event.shiftKey) {
          const moved: NormalizedRect = {
            ...interaction.unionBefore,
            x: interaction.unionBefore.x + dx,
            y: interaction.unionBefore.y + dy,
          };
          const snap = computeSnap(
            moved,
            interaction.others,
            view,
            cssPxPerPoint,
          );
          dx += snap.dx;
          dy += snap.dy;
          setGuides(snap.guides);
        } else if (guides.length > 0) {
          setGuides([]);
        }

        actions.updateElements(
          (items) =>
            items.map((item) => {
              const original = interaction.originals.get(item.id);
              return original ? translateElement(original, dx, dy) : item;
            }),
          true,
        );
        break;
      }

      case "resize": {
        const { original, rectBefore, handle, centerBefore } = interaction;

        // 矢印は端点そのものを動かす。
        if (handle === "start" || handle === "end") {
          if (original.type !== "arrow") break;
          const next =
            handle === "start"
              ? { ...original, x1: point.x, y1: point.y }
              : { ...original, x2: point.x, y2: point.y };
          actions.updateElements(
            (items) =>
              items.map((item) => (item.id === original.id ? next : item)),
            true,
          );
          break;
        }

        // 回転している要素は、ポインタを回転前の座標系へ戻してから計算する。
        const localPointer =
          original.rotation === 0
            ? point
            : rotatePoint(point, centerBefore, -original.rotation, view);

        const after = resizeRect(rectBefore, handle, localPointer.x, localPointer.y, {
          // 折り返し幅を持たないテキストは、幅と高さを個別に持たないため
          // 常に比率を保ってフォントサイズを拡大縮小する。
          keepAspect:
            event.shiftKey ||
            (original.type === "text" && original.width === null),
        });

        let resized = applyResize(original, rectBefore, after, {
          min: MIN_FONT_SIZE,
          max: MAX_FONT_SIZE,
        });

        // 回転しているときは、掴んでいない側の角が動かないように寄せ直す。
        if (original.rotation !== 0) {
          const newRect = elementRect(resized, measureCtx);
          const newCenter = rectCenter(newRect);
          const newAnchorWorld = rotatePoint(
            oppositeCorner(handle, newRect),
            newCenter,
            original.rotation,
            view,
          );
          resized = translateElement(
            resized,
            interaction.anchorWorld.x - newAnchorWorld.x,
            interaction.anchorWorld.y - newAnchorWorld.y,
          );
        }

        actions.updateElements(
          (items) => items.map((item) => (item.id === original.id ? resized : item)),
          true,
        );
        break;
      }

      case "rotate": {
        const current = angleBetween(interaction.center, point, view);
        let next = interaction.original.rotation + (current - interaction.startAngle);
        // Shift で 15 度刻みに吸着。
        if (event.shiftKey) next = Math.round(next / 15) * 15;
        next = ((next % 360) + 360) % 360;

        actions.updateElements(
          (items) =>
            items.map((item) =>
              item.id === interaction.id
                ? { ...item, rotation: Math.round(next * 10) / 10 }
                : item,
            ),
          true,
        );
        break;
      }

      case "draw": {
        actions.updateElements(
          (items) =>
            items.map((item) =>
              item.id === interaction.id
                ? updateDrawElement(
                    item,
                    interaction.start.x,
                    interaction.start.y,
                    point.x,
                    point.y,
                    {
                      constrain: event.shiftKey,
                      pressure:
                        event.pointerType === "pen"
                          ? event.pressure || 0.5
                          : undefined,
                    },
                  )
                : item,
            ),
          true,
        );
        break;
      }
    }
  };

  // --- 離したとき ---------------------------------------------------
  const onPointerUp = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    if (interaction.kind === "idle") return;
    if (interaction.pointerId !== event.pointerId) return;
    interactionRef.current = { kind: "idle" };
    setGuides([]);

    switch (interaction.kind) {
      case "marquee": {
        const area = marquee;
        setMarquee(null);
        if (!area || area.w < 0.004 || area.h < 0.004) break;

        const hits = elements
          .filter(
            (element) =>
              !element.locked &&
              rectsIntersect(elementBoundingRect(element, measureCtx), area),
          )
          .map((element) => element.id);
        actions.setSelection(
          interaction.additive
            ? [...new Set([...interaction.baseSelection, ...hits])]
            : hits,
        );
        break;
      }

      case "textEdit": {
        const area = marquee;
        setMarquee(null);
        if (!area || area.w < 0.005 || area.h < 0.005) break;
        actions.onTextEditRequest?.(pageIndex, area);
        break;
      }

      case "move":
      case "resize":
      case "rotate":
        actions.endTransaction();
        break;

      case "draw": {
        // ここは props の elements ではなく最新の状態を見る。押してから
        // 離すまでが 1 タスクに収まると、props がまだ更新されていない。
        const drawn = actions
          .getElements()
          .find((item) => item.id === interaction.id);
        if (!drawn || isDegenerate(drawn)) {
          // 点をひとつ打っただけの図形は残さない。
          actions.removeElement(interaction.id);
          actions.endTransaction();
          break;
        }
        actions.endTransaction();
        actions.setSelection([drawn.id]);
        actions.onDrawComplete?.(drawn);
        break;
      }
    }
  };

  return {
    marquee,
    guides,
    onBackgroundPointerDown,
    onElementPointerDown,
    onHandlePointerDown,
    onPointerMove,
    onPointerUp,
  };
}

/** ハンドルの向かい側の角。リサイズ中の固定点になる。 */
function oppositeCorner(handle: HandleId, rect: NormalizedRect): Point {
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;

  return {
    x: handle.includes("w") ? right : handle.includes("e") ? left : left + rect.w / 2,
    y: handle.includes("n") ? bottom : handle.includes("s") ? top : top + rect.h / 2,
  };
}

/** 中心から見た点の角度（度）。正規化座標の縦横比を戻してから測る。 */
function angleBetween(
  center: Point,
  point: Point,
  view: { width: number; height: number },
): number {
  const dx = (point.x - center.x) * view.width;
  const dy = (point.y - center.y) * view.height;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}
