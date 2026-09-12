"use client";

import type { FormField } from "@/lib/pdf/forms";

interface FormPanelProps {
  fields: FormField[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  flatten: boolean;
  onFlattenChange: (flatten: boolean) => void;
  onGoToPage: (pageIndex: number) => void;
}

/**
 * フォーム（AcroForm）の記入欄。
 *
 * 入力欄を持つ PDF では、注釈を重ねるより本来の欄へ書いたほうが
 * 見た目も後工程も自然になる。値は自動保存にも含まれる。
 */
export function FormPanel({
  fields,
  values,
  onChange,
  flatten,
  onFlattenChange,
  onGoToPage,
}: FormPanelProps) {
  if (fields.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
        このPDFには入力欄が
        <br />
        見つかりませんでした。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={flatten}
          onChange={(event) => onFlattenChange(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-blue-600"
        />
        <span>
          書き出し時に入力欄を固定する
          <span className="mt-0.5 block text-[11px] text-slate-400">
            受け取った人が書き換えられなくなります。
          </span>
        </span>
      </label>

      <ul className="space-y-3">
        {fields.map((field) => {
          const value = values[field.name] ?? field.value;
          const id = `form-${field.name}`;

          return (
            <li key={field.name}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <label
                  htmlFor={id}
                  className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600"
                  title={field.name}
                >
                  {field.name}
                </label>
                {field.pageIndex >= 0 && (
                  <button
                    type="button"
                    onClick={() => onGoToPage(field.pageIndex)}
                    className="shrink-0 text-[11px] text-blue-600 hover:underline"
                  >
                    P{field.pageIndex + 1}
                  </button>
                )}
              </div>

              {field.kind === "checkbox" ? (
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    id={id}
                    type="checkbox"
                    checked={value === "on"}
                    disabled={field.readOnly}
                    onChange={(event) =>
                      onChange(field.name, event.target.checked ? "on" : "")
                    }
                    className="h-4 w-4 accent-blue-600"
                  />
                  チェック
                </label>
              ) : field.kind === "radio" || field.kind === "dropdown" ? (
                <select
                  id={id}
                  value={value}
                  disabled={field.readOnly}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus-visible:border-blue-500 focus-visible:outline-none disabled:bg-slate-50"
                >
                  <option value="">（未選択）</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  value={value}
                  disabled={field.readOnly}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus-visible:border-blue-500 focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
