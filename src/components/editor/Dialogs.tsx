"use client";

import { useEffect, useRef, useState } from "react";
import { LockIcon } from "./Icons";

/** 画面中央に出す小さなダイアログの土台。 */
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}

interface PasswordDialogProps {
  fileName: string;
  wasWrong: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/** パスワード保護された PDF を開くための入力。 */
export function PasswordDialog({
  fileName,
  wasWrong,
  onSubmit,
  onCancel,
}: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <Overlay>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (password.length > 0) onSubmit(password);
        }}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
            <LockIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-800">
              パスワードで保護されています
            </h2>
            <p className="mt-1 truncate text-xs text-slate-500" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="パスワード"
          aria-label="パスワード"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue-500/30"
        />

        {wasWrong && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            パスワードが違います。もう一度入力してください。
          </p>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          入力したパスワードはブラウザ内でのみ使われます。書き出した PDF に
          保護は引き継がれません。
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={password.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
          >
            開く
          </button>
        </div>
      </form>
    </Overlay>
  );
}

interface RestoreDialogProps {
  description: string;
  onRestore: () => void;
  onDiscard: () => void;
}

/** 自動保存から復帰するか尋ねる。 */
export function RestoreDialog({
  description,
  onRestore,
  onDiscard,
}: RestoreDialogProps) {
  return (
    <Overlay>
      <h2 className="text-sm font-semibold text-slate-800">
        前回の編集内容が残っています
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{description}</p>
      <p className="mt-3 text-[11px] text-slate-400">
        内容はこのブラウザ内にだけ保存されています。
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
        >
          破棄して新規
        </button>
        <button
          type="button"
          onClick={onRestore}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          続きから再開
        </button>
      </div>
    </Overlay>
  );
}

interface PromptDialogProps {
  title: string;
  defaultValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** 名前を尋ねるだけの入力（スタンプの登録などに使う）。 */
export function PromptDialog({
  title,
  defaultValue,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Overlay>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim().length > 0) onSubmit(value.trim());
        }}
      >
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={title}
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue-500/30"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={value.trim().length === 0}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
          >
            保存
          </button>
        </div>
      </form>
    </Overlay>
  );
}
