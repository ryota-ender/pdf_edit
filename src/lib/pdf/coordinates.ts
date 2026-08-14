import type { PageSize, RotationDelta } from "@/types/editor";

/**
 * 座標系の対応関係
 * ------------------------------------------------------------------
 * このアプリには 3 つの座標系が登場する。
 *
 * 1. 正規化座標 (normalized)
 *      要素の保存形式。表示ページの左上を (0, 0)、右下を (1, 1) とする。
 *      ズーム率・ウィンドウ幅・デバイスピクセル比に一切依存しない。
 *
 * 2. ビュー座標 (view / PDF ポイント)
 *      表示中のページを「回転を適用した状態」で見たときの座標。
 *      左上が原点で Y は下向き。単位は PDF ポイント。
 *      SVG の viewBox がこの座標系なので、描画時はそのまま使える。
 *
 * 3. PDF ユーザー空間 (pdf user space)
 *      pdf-lib で描画するときの座標。ページ回転を適用する **前** の
 *      座標系で、左下が原点、Y は上向き。
 *
 * 画面ピクセルは「ビュー座標 × cssPxPerPoint」でしかないため、
 * 独立した座標系としては扱わない。
 */

/** ズーム 100% における 1 PDF ポイントあたりの CSS ピクセル数 (96dpi / 72dpi)。 */
export const CSS_PX_PER_POINT = 96 / 72;

/** ズーム率と、表示ページのポイント寸法をまとめたもの。 */
export interface PageViewMetrics {
  /** 回転適用後のページ幅 (ポイント)。 */
  viewWidth: number;
  /** 回転適用後のページ高さ (ポイント)。 */
  viewHeight: number;
  /** 1 ポイントあたりの CSS ピクセル数。 */
  cssPxPerPoint: number;
}

/** ページ回転を適用した後の見かけ上のページ寸法を返す。 */
export function rotatedPageSize(size: PageSize, rotation: number): PageSize {
  return normalizeAngle(rotation) % 180 === 90
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/** 任意の角度を 0/90/180/270 に丸める。 */
export function normalizeAngle(angle: number): RotationDelta {
  const wrapped = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return wrapped as RotationDelta;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * ビュー座標 (左上原点・Y下向き) を PDF ユーザー空間 (左下原点・Y上向き) へ変換する。
 *
 * `box` は pdf-lib から取得したページの CropBox。MediaBox の原点が (0,0) でない
 * PDF でも正しい位置に描けるよう、原点のオフセットを加算している。
 * `rotation` は書き出し後のページに設定される最終的な回転角。
 */
export function viewPointToPdfPoint(
  viewX: number,
  viewY: number,
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
): { x: number; y: number } {
  const { width: w, height: h } = box;
  let localX: number;
  let localY: number;

  switch (normalizeAngle(rotation)) {
    case 90:
      localX = viewY;
      localY = viewX;
      break;
    case 180:
      localX = w - viewX;
      localY = viewY;
      break;
    case 270:
      localX = w - viewY;
      localY = h - viewX;
      break;
    default:
      localX = viewX;
      localY = h - viewY;
      break;
  }

  return { x: box.x + localX, y: box.y + localY };
}

/** `#rrggbb` / `#rgb` を pdf-lib の 0〜1 の RGB 成分へ変換する。 */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(expanded.slice(0, 2), 16) / 255,
    g: parseInt(expanded.slice(2, 4), 16) / 255,
    b: parseInt(expanded.slice(4, 6), 16) / 255,
  };
}
