"use client";

import { useState } from "react";
import { ELEMENT_LABELS } from "@/lib/pdf/elementDefaults";
import { CheckIcon, CommentIcon, TrashIcon } from "./Icons";
import type { CommentReply, EditorElement } from "@/types/editor";

interface CommentsPanelProps {
  /** 文書全体の要素（ページ番号つきで一覧に出す）。 */
  elements: EditorElement[];
  selectedIds: string[];
  authorName: string;
  onAuthorNameChange: (name: string) => void;
  onSelect: (ids: string[], pageIndex: number) => void;
  onAddComment: (id: string, text: string) => void;
  onAddReply: (id: string, text: string) => void;
  onToggleResolved: (id: string) => void;
  onDeleteComment: (id: string) => void;
}

/**
 * コメント一覧。
 *
 * レビューでは「誰が・どこに・何を言ったか」が本体なので、
 * 注釈にコメントと返信をぶら下げられるようにする。書き出しでは
 * PDF 注釈の /Contents と返信注釈として持ち出せる。
 */
export function CommentsPanel({
  elements,
  selectedIds,
  authorName,
  onAuthorNameChange,
  onSelect,
  onAddComment,
  onAddReply,
  onToggleResolved,
  onDeleteComment,
}: CommentsPanelProps) {
  const withComments = elements.filter((element) => element.comment);
  const selected = elements.find((element) => selectedIds.includes(element.id));

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-slate-600">
          あなたの名前
        </span>
        <input
          value={authorName}
          onChange={(event) => onAuthorNameChange(event.target.value)}
          placeholder="名前を入力"
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus-visible:border-blue-500 focus-visible:outline-none"
        />
      </label>

      {selected && !selected.comment && (
        <NewComment
          label={ELEMENT_LABELS[selected.type]}
          onSubmit={(text) => onAddComment(selected.id, text)}
        />
      )}

      {withComments.length === 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
          コメントはまだありません。
          <br />
          要素を選んでコメントを追加できます。
        </p>
      )}

      <ul className="space-y-2">
        {withComments.map((element) => {
          const thread = element.comment!;
          return (
            <li
              key={element.id}
              className={`rounded-lg border px-3 py-2.5 transition-colors ${
                thread.resolved
                  ? "border-slate-200 bg-slate-50 opacity-70"
                  : selectedIds.includes(element.id)
                    ? "border-blue-300 bg-blue-50/50"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onSelect([element.id], element.pageIndex)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <CommentIcon className="h-3 w-3" />
                    {thread.author || "名無し"}
                    <span className="text-slate-400">
                      · P{element.pageIndex + 1} · {ELEMENT_LABELS[element.type]}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-slate-800">
                    {thread.text}
                  </p>
                </button>

                <div className="flex shrink-0 items-center">
                  <IconButton
                    label={thread.resolved ? "未解決に戻す" : "解決済みにする"}
                    onClick={() => onToggleResolved(element.id)}
                    active={thread.resolved}
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label="コメントを削除"
                    onClick={() => onDeleteComment(element.id)}
                    danger
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </div>

              {thread.replies.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-2.5">
                  {thread.replies.map((reply: CommentReply) => (
                    <li key={reply.id}>
                      <p className="text-[11px] text-slate-500">
                        {reply.author || "名無し"}
                      </p>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
                        {reply.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {!thread.resolved && (
                <ReplyBox onSubmit={(text) => onAddReply(element.id, text)} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewComment({
  label,
  onSubmit,
}: {
  label: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) {
          onSubmit(text.trim());
          setText("");
        }
      }}
      className="rounded-lg border border-blue-200 bg-blue-50/40 px-3 py-2.5"
    >
      <p className="text-[11px] font-medium text-blue-700">
        選択中の{label}にコメント
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        placeholder="気づいた点を書く"
        aria-label="コメント本文"
        className="mt-1.5 w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-xs focus-visible:border-blue-500 focus-visible:outline-none"
      />
      <button
        type="submit"
        disabled={text.trim().length === 0}
        className="mt-1.5 w-full rounded-md bg-blue-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
      >
        コメントを追加
      </button>
    </form>
  );
}

function ReplyBox({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) {
          onSubmit(text.trim());
          setText("");
        }
      }}
      className="mt-2 flex gap-1"
    >
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="返信する"
        aria-label="返信"
        className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs focus-visible:border-blue-500 focus-visible:outline-none"
      />
      <button
        type="submit"
        disabled={text.trim().length === 0}
        className="shrink-0 rounded-md border border-slate-300 px-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:text-slate-300"
      >
        送信
      </button>
    </form>
  );
}

function IconButton({
  label,
  onClick,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded p-1 transition-colors ${
        active
          ? "text-green-600"
          : danger
            ? "text-slate-400 hover:bg-red-50 hover:text-red-600"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
