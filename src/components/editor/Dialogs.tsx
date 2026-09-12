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
        内容はこのブラウザ内にだけ保存されています。開かなくても消えないので、
        あとから「最近の文書」で開き直せます。
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
        >
          今は開かない
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

interface SignatureDialogProps {
  defaultName: string;
  isWorking: boolean;
  onSign: (options: {
    mode: "self" | "p12";
    name: string;
    reason: string;
    file: File | null;
    password: string;
  }) => void;
  onCancel: () => void;
}

/** 電子署名の設定。 */
export function SignatureDialog({
  defaultName,
  isWorking,
  onSign,
  onCancel,
}: SignatureDialogProps) {
  const [mode, setMode] = useState<"self" | "p12">("self");
  const [name, setName] = useState(defaultName);
  const [reason, setReason] = useState("内容を確認しました");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");

  return (
    <Overlay>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSign({ mode, name, reason, file, password });
        }}
      >
        <h2 className="text-sm font-semibold text-slate-800">電子署名</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          文書に署名して、あとから改ざんされていないことを確認できるようにします。
        </p>

        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="radio"
              name="sig-mode"
              checked={mode === "self"}
              onChange={() => setMode("self")}
              className="mt-0.5 accent-blue-600"
            />
            <span>
              この場で証明書を作る（自己署名）
              <span className="mt-0.5 block text-[11px] text-slate-400">
                改ざんの検知はできますが、署名者の身元は保証されません。
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="radio"
              name="sig-mode"
              checked={mode === "p12"}
              onChange={() => setMode("p12")}
              className="mt-0.5 accent-blue-600"
            />
            <span>
              手持ちの証明書を使う（.p12 / .pfx）
              <span className="mt-0.5 block text-[11px] text-slate-400">
                鍵はブラウザ内だけで使われ、送信されません。
              </span>
            </span>
          </label>
        </div>

        {mode === "self" ? (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              署名者名
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="署名者名"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:border-blue-500 focus-visible:outline-none"
            />
          </label>
        ) : (
          <div className="mt-3 space-y-2">
            <input
              type="file"
              accept=".p12,.pfx"
              aria-label="証明書ファイル"
              onChange={(event) => setFile(event.target.files?.item(0) ?? null)}
              className="w-full text-xs text-slate-600 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs"
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="証明書のパスワード"
              aria-label="証明書のパスワード"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:border-blue-500 focus-visible:outline-none"
            />
          </div>
        )}

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            署名の理由
          </span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="署名の理由"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:border-blue-500 focus-visible:outline-none"
          />
        </label>

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
            disabled={isWorking || (mode === "p12" && !file)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
          >
            {isWorking ? "署名中…" : "署名して書き出す"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

interface OcrDialogProps {
  pageCount: number;
  isWorking: boolean;
  progress: { ratio: number; label: string } | null;
  onRun: (options: { scope: "page" | "all"; language: string }) => void;
  onCancel: () => void;
}

/** スキャンPDFの文字起こし。 */
export function OcrDialog({
  pageCount,
  isWorking,
  progress,
  onRun,
  onCancel,
}: OcrDialogProps) {
  const [scope, setScope] = useState<"page" | "all">("page");
  const [language, setLanguage] = useState("jpn+eng");

  return (
    <Overlay>
      <h2 className="text-sm font-semibold text-slate-800">
        文字認識 (OCR)
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        スキャンされたPDFの文字を読み取ります。読み取ると、検索・
        ハイライトの行吸着・既存テキストの書き換えが使えるようになります。
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            対象
          </span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as "page" | "all")}
            disabled={isWorking}
            aria-label="認識する範囲"
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="page">表示中のページのみ</option>
            <option value="all">すべてのページ（{pageCount}ページ）</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            言語
          </span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            disabled={isWorking}
            aria-label="認識する言語"
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="jpn+eng">日本語＋英語</option>
            <option value="jpn">日本語のみ</option>
            <option value="eng">英語のみ</option>
          </select>
        </label>
      </div>

      {progress && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>{progress.label}</span>
            <span className="tabular-nums">
              {Math.round(progress.ratio * 100)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        認識はブラウザ内で行われ、画像も結果も送信されません。
        ページ数が多いと時間がかかります。
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
        >
          {isWorking ? "閉じる" : "キャンセル"}
        </button>
        <button
          type="button"
          onClick={() => onRun({ scope, language })}
          disabled={isWorking}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
        >
          {isWorking ? "認識中…" : "読み取る"}
        </button>
      </div>
    </Overlay>
  );
}
