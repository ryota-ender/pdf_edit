"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Undo / Redo 付きの状態管理。
 *
 * ドラッグやスライダー操作は 1 回の操作で何十回も値が変わるため、
 * 「履歴に積む更新」と「積まない更新」を分けている。
 *
 *   commit(next)                 … 1 操作 = 1 履歴。追加・削除・数値入力など。
 *   beginTransaction() →
 *     updateTransient(next) × N →
 *   endTransaction()             … ドラッグや連続入力。開始時点の値を 1 件だけ積む。
 */
export interface HistoryController<T> {
  state: T;
  canUndo: boolean;
  canRedo: boolean;
  /** 履歴に 1 件積んでから更新する。 */
  commit: (updater: T | ((current: T) => T)) => void;
  /** 履歴を触らずに現在値だけ差し替える。 */
  updateTransient: (updater: T | ((current: T) => T)) => void;
  /** 連続操作の開始。この時点の値が undo 先になる。 */
  beginTransaction: () => void;
  /** 連続操作の終了。値が変わっていれば履歴へ 1 件だけ積む。 */
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;
  /** 履歴ごと初期化する（別ファイルを開いたとき）。 */
  reset: (next: T) => void;
}

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

const HISTORY_LIMIT = 100;

function resolve<T>(updater: T | ((current: T) => T), current: T): T {
  return typeof updater === "function"
    ? (updater as (current: T) => T)(current)
    : updater;
}

export function useEditorHistory<T>(initial: T): HistoryController<T> {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: [],
  });

  // トランザクション開始時の値。endTransaction までここに退避しておく。
  const transactionBaseRef = useRef<T | null>(null);

  const commit = useCallback((updater: T | ((current: T) => T)) => {
    setHistory((current) => {
      const next = resolve(updater, current.present);
      if (Object.is(next, current.present)) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const updateTransient = useCallback((updater: T | ((current: T) => T)) => {
    setHistory((current) => {
      const next = resolve(updater, current.present);
      if (Object.is(next, current.present)) return current;
      return { ...current, present: next };
    });
  }, []);

  const beginTransaction = useCallback(() => {
    setHistory((current) => {
      transactionBaseRef.current = current.present;
      return current;
    });
  }, []);

  const endTransaction = useCallback(() => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (base === null) return;

    setHistory((current) => {
      if (Object.is(base, current.present)) return current;
      return {
        past: [...current.past, base].slice(-HISTORY_LIMIT),
        present: current.present,
        future: [...current.future],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (previous === undefined) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const [next, ...rest] = current.future;
      if (next === undefined) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next,
        future: rest,
      };
    });
  }, []);

  const reset = useCallback((next: T) => {
    transactionBaseRef.current = null;
    setHistory({ past: [], present: next, future: [] });
  }, []);

  return useMemo(
    () => ({
      state: history.present,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      commit,
      updateTransient,
      beginTransaction,
      endTransaction,
      undo,
      redo,
      reset,
    }),
    [
      history,
      commit,
      updateTransient,
      beginTransaction,
      endTransaction,
      undo,
      redo,
      reset,
    ],
  );
}
