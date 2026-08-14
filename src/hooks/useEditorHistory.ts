"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Undo / Redo 付きの状態管理。
 *
 * ドラッグやキー入力は 1 操作で何十回も値が変わるため、
 * 「履歴に積む更新」と「積まない更新」を分けている。
 *
 *   commit(next)                 … 1 操作 = 1 履歴。追加・削除・数値入力など。
 *   beginTransaction() →
 *     updateTransient(next) × N →
 *   endTransaction()             … ドラッグや文字入力。開始時点の値を 1 件だけ積む。
 *
 * 値は state と ref の両方に持つ。描画は state を使い、操作の途中で
 * 「今の値」を読むところは ref を使う。beginTransaction が最新値を
 * 同期的に読めないと、直後の endTransaction が誤った地点を履歴へ積むため。
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
  // 描画には state を、操作の中での「今の値」の参照には ref を使う。
  // 両者は write() で必ず同時に更新する。
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: [],
  });
  const stateRef = useRef(state);

  // トランザクション開始時の値。endTransaction までここに退避しておく。
  const transactionBaseRef = useRef<T | null>(null);

  const write = useCallback((next: HistoryState<T>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const commit = useCallback(
    (updater: T | ((current: T) => T)) => {
      const current = stateRef.current;
      const next = resolve(updater, current.present);
      if (Object.is(next, current.present)) return;
      write({
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
      });
    },
    [write],
  );

  const updateTransient = useCallback(
    (updater: T | ((current: T) => T)) => {
      const current = stateRef.current;
      const next = resolve(updater, current.present);
      if (Object.is(next, current.present)) return;
      write({ ...current, present: next });
    },
    [write],
  );

  const beginTransaction = useCallback(() => {
    // 入れ子で呼ばれても最初の地点を保つ。
    transactionBaseRef.current ??= stateRef.current.present;
  }, []);

  const endTransaction = useCallback(() => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (base === null) return;

    const current = stateRef.current;
    if (Object.is(base, current.present)) return;
    write({
      past: [...current.past, base].slice(-HISTORY_LIMIT),
      present: current.present,
      future: [],
    });
  }, [write]);

  const undo = useCallback(() => {
    // 操作の途中で undo された場合は、その操作を無かったことにする。
    transactionBaseRef.current = null;
    const current = stateRef.current;
    const previous = current.past.at(-1);
    if (previous === undefined) return;
    write({
      past: current.past.slice(0, -1),
      present: previous,
      future: [current.present, ...current.future],
    });
  }, [write]);

  const redo = useCallback(() => {
    transactionBaseRef.current = null;
    const current = stateRef.current;
    const [next, ...rest] = current.future;
    if (next === undefined) return;
    write({
      past: [...current.past, current.present].slice(-HISTORY_LIMIT),
      present: next,
      future: rest,
    });
  }, [write]);

  const reset = useCallback(
    (next: T) => {
      transactionBaseRef.current = null;
      write({ past: [], present: next, future: [] });
    },
    [write],
  );

  return useMemo(
    () => ({
      state: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      commit,
      updateTransient,
      beginTransaction,
      endTransaction,
      undo,
      redo,
      reset,
    }),
    [
      state,
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
