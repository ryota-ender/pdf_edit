/**
 * 表示単位
 * ------------------------------------------------------------------
 * 内部では位置と大きさを「ページに対する比率 (0〜1)」で持っている。
 * これは表示倍率に左右されない利点がある一方、人が数値で指定したいときは
 * mm やポイントのほうが分かりやすい。ここで相互に変換する。
 */

export type Unit = "percent" | "mm" | "pt";

export const UNIT_LABELS: Record<Unit, string> = {
  percent: "%",
  mm: "mm",
  pt: "pt",
};

/** 1 インチ = 72 ポイント = 25.4 mm。 */
const MM_PER_POINT = 25.4 / 72;

/** 比率 → 表示用の数値。 */
export function formatLength(
  ratio: number,
  totalPoints: number,
  unit: Unit,
): number {
  if (unit === "percent") return Number((ratio * 100).toFixed(1));
  const points = ratio * totalPoints;
  if (unit === "pt") return Number(points.toFixed(1));
  return Number((points * MM_PER_POINT).toFixed(1));
}

/** 表示用の数値 → 比率。 */
export function parseLength(
  value: number,
  totalPoints: number,
  unit: Unit,
): number {
  if (!Number.isFinite(value)) return 0;
  if (unit === "percent") return value / 100;
  const points = unit === "pt" ? value : value / MM_PER_POINT;
  return totalPoints > 0 ? points / totalPoints : 0;
}
