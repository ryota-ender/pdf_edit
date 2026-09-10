import type { EditorDoc } from "@/types/editor";

/**
 * 編集内容の自動保存
 * ------------------------------------------------------------------
 * リロードや誤ってタブを閉じたときに作業が消えないよう、IndexedDB へ
 * 丸ごと控えておく。元 PDF のバイト列と貼り付けた画像も一緒に保存する
 * ので、ファイルを選び直さずに続きから再開できる。
 *
 * 保存先はブラウザのローカルストレージ領域だけで、サーバーへは一切
 * 送信しない。
 */

const DB_NAME = "pdf-editor";
const DB_VERSION = 1;
const STORE = "sessions";
const KEY = "current";

export interface StoredSource {
  id: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface StoredImage {
  id: string;
  format: "png" | "jpg";
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface StoredSession {
  savedAt: number;
  doc: EditorDoc;
  sources: StoredSource[];
  images: StoredImage[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await withStore("readwrite", (store) => store.put(session, KEY));
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const value = await withStore<StoredSession | undefined>("readonly", (store) =>
      store.get(KEY),
    );
    return value ?? null;
  } catch {
    // 保存領域が使えない環境（プライベートウィンドウ等）でも編集は続けられる。
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(KEY));
  } catch {
    // 消せなくても実害はないので黙って諦める。
  }
}

/** 保存されている内容の概要。復帰を促すダイアログに使う。 */
export function describeSession(session: StoredSession): string {
  const names = session.sources.map((source) => source.fileName).join("、");
  const elements = session.doc.elements.length;
  const when = new Date(session.savedAt).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${names}（編集要素 ${elements} 個・${when}）`;
}
