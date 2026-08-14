/** 選択できるツール。 */
export type ToolId = "select" | "text";

/** 編集レイヤーに追加されたテキスト要素。 */
export interface TextElement {
  id: string;
  type: "text";
  /** `EditorDoc.pages` 内でのページ位置（表示順）。 */
  pageIndex: number;
  /**
   * テキストブロック左端の正規化X座標 (0〜1)。
   * 表示中のページ幅に対する比率で持つため、ズーム率やウィンドウ幅に依存しない。
   */
  x: number;
  /**
   * テキストブロック上端の正規化Y座標 (0〜1)。
   * 画面と同じく「上方向が0」。PDF書き出し時に下原点へ変換する。
   */
  y: number;
  text: string;
  /** PDFポイント (1/72インチ) 単位のフォントサイズ。 */
  fontSize: number;
  /** `#rrggbb` 形式。 */
  color: string;
}

export type EditorElement = TextElement;

/** ページに対して 90 度単位で加える回転量。 */
export type RotationDelta = 0 | 90 | 180 | 270;

/** 編集後のドキュメントに残っている 1 ページ分の状態。 */
export interface PageState {
  /** 元 PDF における 0 始まりのページ番号。ページ削除しても変わらない。 */
  sourceIndex: number;
  /** 元 PDF のページ回転に対して、エディタ上で追加した時計回りの回転量。 */
  rotation: RotationDelta;
}

/**
 * Undo / Redo の対象になる編集内容のすべて。
 * 元 PDF のバイト列はここには含めず、常に読み込み時のまま保持する。
 */
export interface EditorDoc {
  pages: PageState[];
  elements: EditorElement[];
}

/** ページ 1 枚の寸法。単位は PDF ポイント。 */
export interface PageSize {
  width: number;
  height: number;
}
