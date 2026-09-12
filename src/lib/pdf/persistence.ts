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
/** 直近に開いていた文書を指すキー。 */
const CURRENT_KEY = "current";
/** 保持する文書の数。これを超えたら古いものから捨てる。 */
const MAX_SLOTS = 8;

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
  /** 文書ごとの識別子。開いているファイルの組み合わせから決める。 */
  id: string;
  savedAt: number;
  doc: EditorDoc;
  sources: StoredSource[];
  images: StoredImage[];
  /** フォーム欄へ記入した値。 */
  formValues?: Record<string, string>;
  /** どのタブが書いたか。別タブの上書きを検出するために使う。 */
  ownerId?: string;
}

/** 一覧に出すための要約（本体を読み込まずに済ませる）。 */
export interface SessionSummary {
  id: string;
  savedAt: number;
  fileNames: string[];
  pageCount: number;
  elementCount: number;
}

/** 開いているファイルの組から、文書の識別子を決める。 */
export function sessionIdFor(fileNames: string[]): string {
  return `doc:${fileNames.join("|")}`;
}

/**
 * このタブを表す識別子。
 * 同じブラウザで複数タブを開いたとき、自動保存が互いを潰さないよう、
 * 「誰が書いたか」を保存内容に残しておく。
 */
export const TAB_ID = `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

/**
 * 保存してよいかを判定する。
 * 別のタブが自分より後に書いていたら、そのタブに任せる。
 */
export async function canTakeOver(): Promise<
  { ok: true } | { ok: false; owner: string; savedAt: number }
> {
  const existing = await loadSession();
  if (!existing || !existing.ownerId || existing.ownerId === TAB_ID) {
    return { ok: true };
  }
  return { ok: false, owner: existing.ownerId, savedAt: existing.savedAt };
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
  await withStore("readwrite", (store) => store.put(session, session.id));
  // 「最後に開いていたのはこれ」を別キーで覚えておく。
  await withStore("readwrite", (store) => store.put(session.id, CURRENT_KEY));
  await pruneOldSessions();
}

export async function loadSession(id?: string): Promise<StoredSession | null> {
  try {
    const key =
      id ??
      (await withStore<string | undefined>("readonly", (store) =>
        store.get(CURRENT_KEY),
      ));
    if (!key) return null;

    const value = await withStore<StoredSession | undefined>("readonly", (store) =>
      store.get(key),
    );
    return value ?? null;
  } catch {
    // 保存領域が使えない環境（プライベートウィンドウ等）でも編集は続けられる。
    return null;
  }
}

export async function clearSession(id?: string): Promise<void> {
  try {
    if (id) {
      await withStore("readwrite", (store) => store.delete(id));
      return;
    }
    const key = await withStore<string | undefined>("readonly", (store) =>
      store.get(CURRENT_KEY),
    );
    if (key) await withStore("readwrite", (store) => store.delete(key));
    await withStore("readwrite", (store) => store.delete(CURRENT_KEY));
  } catch {
    // 消せなくても実害はないので黙って諦める。
  }
}

/** 保存されている文書の一覧（新しい順）。 */
export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const all = await withStore<StoredSession[]>("readonly", (store) =>
      store.getAll(),
    );
    return all
      .filter((item): item is StoredSession => typeof item === "object" && item !== null && "id" in item)
      .map((item) => ({
        id: item.id,
        savedAt: item.savedAt,
        fileNames: item.sources.map((source) => source.fileName),
        pageCount: item.doc.pages.length,
        elementCount: item.doc.elements.length,
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** 古い文書を捨てて、保存容量が際限なく増えないようにする。 */
async function pruneOldSessions(): Promise<void> {
  try {
    const sessions = await listSessions();
    for (const session of sessions.slice(MAX_SLOTS)) {
      await withStore("readwrite", (store) => store.delete(session.id));
    }
  } catch {
    // 整理に失敗しても保存自体は済んでいる。
  }
}

/** 保存されている内容の概要。復帰を促すダイアログに使う。 */
export function describeSession(
  session: StoredSession | SessionSummary,
): string {
  const names =
    "sources" in session
      ? session.sources.map((source) => source.fileName).join("、")
      : session.fileNames.join("、");
  const elements =
    "doc" in session ? session.doc.elements.length : session.elementCount;
  const when = new Date(session.savedAt).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${names}（編集要素 ${elements} 個・${when}）`;
}
