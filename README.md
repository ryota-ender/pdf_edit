# PDF Editor

ブラウザだけで動く PDF エディタです。PDF を読み込み、好きな位置に日本語テキストを
置いて、編集内容を焼き込んだ PDF として書き出せます。

**PDF はサーバーへアップロードされません。** 読み込みから書き出しまで、すべての処理が
お使いのブラウザ内で完結します。バックエンドはありません。

---

## 機能

### PDF の表示

- ドラッグ&ドロップ / ファイル選択での読み込み
- 複数ページ対応、左サイドバーのサムネイルからページ移動
- ズーム 50% / 75% / 100% / 125% / 150%
- 縦横比の維持、ページ回転 (`/Rotate`) を持つ PDF の正しい表示
- 日本語 PDF の表示 (CMap 同梱)

### 編集

| 操作 | 内容 |
| --- | --- |
| テキスト追加 | テキストツールでページをクリック。その場で入力できます |
| 再編集 | 要素をダブルクリック、または右パネルのテキスト欄 |
| 移動 | ドラッグ&ドロップ。ページ外へは出せません |
| フォントサイズ | 8〜100pt |
| 文字色 | カラーピッカー + プリセット |
| 位置 | X / Y をパーセントで直接指定 |
| 削除 | 右パネルの削除ボタン、または `Delete` / `Backspace` |
| Undo / Redo | `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` |

日本語入力 (IME) に対応しています。複数行のテキストも入力できます。

### ページ管理

- ページ選択
- ページ回転 (90° 単位)
- ページ削除

### 書き出し

元 PDF に編集レイヤーを焼き込んだ新しい PDF を生成し、`<元のファイル名>-edited.pdf`
としてダウンロードします。

### キーボードショートカット

| キー | 動作 |
| --- | --- |
| `V` | 選択ツール |
| `T` | テキストツール |
| `Delete` / `Backspace` | 選択中の要素を削除 |
| `Escape` | 選択解除 / 編集終了 |
| `Cmd/Ctrl + Z` | 元に戻す |
| `Cmd/Ctrl + Shift + Z` | やり直す |
| `Cmd/Ctrl + Enter` | テキスト入力を確定 |

---

## 使用技術

| 用途 | 採用 |
| --- | --- |
| フレームワーク | Next.js 16 (App Router) / React 19 |
| 言語 | TypeScript |
| スタイル | Tailwind CSS v4 |
| PDF 表示 | pdfjs-dist (PDF.js) |
| PDF 生成 | pdf-lib |
| フォント埋め込み | fontkit / @pdf-lib/fontkit |
| 日本語フォント | Noto Sans JP (SIL OFL 1.1) |

状態管理は React の state とカスタムフックのみで、外部の状態管理ライブラリは
使っていません。ドラッグ操作も Pointer Events による自前実装です。

---

## セットアップ

必要環境: Node.js 20.9 以上

```bash
npm install
```

`postinstall` で PDF.js の worker・CMap・標準フォントが `node_modules` から
`public/pdfjs/` へ複製されます。

### 起動

```bash
npm run dev
```

http://localhost:3000 を開いてください。

### ビルド

```bash
npm run build
npm run start
```

### 検査

```bash
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

---

## PDF 処理の仕組み

### 表示と編集の分離

元 PDF の canvas を書き換えることはしません。PDF.js が描いた canvas の上に、
編集専用のレイヤーを重ねています。

```text
PDF Page Container (position: relative)
 ├── <canvas>            PDF.js が描画した元ページ（読み取り専用）
 ├── <svg>               編集レイヤー
 │    ├── <text>         テキスト要素
 │    └── <rect>         選択枠 / 当たり判定
 └── <textarea>          入力中だけ現れるインラインエディタ
```

編集レイヤーを SVG にしているのは、**位置精度のため**です。SVG の `<text>` は
`y` 座標がそのままベースラインになります。これは PDF の描画モデルと同じなので、
`pdf-lib` の `drawText` へ渡す座標をそのまま画面にも使えます。HTML の `<div>` を
使うと、ベースライン位置がブラウザの `line-height` 解釈や OS ごとのフォント
メトリクス選択に左右され、環境によって位置がずれます。

### 編集データ

```ts
type TextElement = {
  id: string;
  type: "text";
  pageIndex: number;   // 表示中のページ順での位置
  x: number;           // 正規化X座標 (0〜1)
  y: number;           // 正規化Y座標 (0〜1)、上が 0
  text: string;
  fontSize: number;    // PDFポイント (1/72インチ)
  color: string;       // #rrggbb
};
```

座標はピクセルではなく **ページ幅・高さに対する比率 (0〜1)** で保持します。
そのため、ウィンドウサイズを変えてもズーム率を変えても位置はずれません。
フォントサイズは画面ピクセルではなく PDF ポイントで持つので、こちらもズームに
依存しません。

Undo / Redo の対象は「ページ構成 + 全要素」をまとめた 1 つのオブジェクトです。
そのためテキスト操作だけでなくページ削除・回転も元に戻せます。

---

## 座標変換の仕組み

このアプリには 3 つの座標系があります。

| 座標系 | 原点 | Y方向 | 単位 |
| --- | --- | --- | --- |
| 正規化座標 | ページ左上 | 下 | 比率 (0〜1) |
| ビュー座標 | ページ左上 | 下 | PDFポイント |
| PDF ユーザー空間 | ページ左下 | 上 | PDFポイント |

### 1. 正規化座標 → ビュー座標

```ts
viewX = x * viewWidth;
viewY = y * viewHeight;
```

`viewWidth / viewHeight` はページ回転を適用した後の寸法です。画面のピクセル数は
「ビュー座標 × ズーム率 × 96/72」でしかないため、独立した座標系としては扱いません。
SVG の `viewBox` をビュー座標に合わせてあるので、ズームは SVG のスケールだけで
吸収され、内部の数値はズーム率に一切依存しません。

### 2. 上端 → ベースライン

`y` はテキストブロックの上端です。PDF の `drawText` はベースライン基準なので、
フォントのアセントぶん下げます。

```ts
baselineY = viewY + ascentRatio * fontSize;
```

`ascentRatio` は fontkit で実フォントから読んだ値 (Noto Sans JP なら 1.16) です。
2 行目以降は `LINE_HEIGHT_FACTOR (1.25) × fontSize` ずつ下がります。この計算は
プレビューと書き出しで同じ関数 (`src/lib/pdf/textLayout.ts`) を使うため、
必ず一致します。

### 3. ビュー座標 → PDF ユーザー空間

Y の反転に加えて、ページ回転と CropBox の原点オフセットを考慮します。

```ts
// 回転 0° の場合
pdfX = cropBox.x + viewX;
pdfY = cropBox.y + (cropBox.height - baselineY);
```

90° / 180° / 270° 回転したページでは軸の対応が入れ替わります
(`src/lib/pdf/coordinates.ts` の `viewPointToPdfPoint`)。文字自体も正しい向きで
載るよう、`drawText` に `rotate` を渡しています。

MediaBox / CropBox の原点が `(0, 0)` でない PDF でも正しい位置に描けるよう、
CropBox のオフセットを加算しています。

### 精度

自動確認スクリプトで、プレビューの実描画ピクセルと書き出した PDF の実描画
ピクセルを突き合わせています。A4 ページで **ズレはページ寸法の 0.15% 未満**
(1pt 前後) に収まっています。回転ページ・CropBox オフセットありの PDF でも
同じ精度です。

---

## 日本語対応

`pdf-lib` の標準 14 フォントは日本語を持たないため、Noto Sans JP を PDF へ
埋め込んでいます。フォントは `public/fonts/` に同梱し、ライセンス全文
(`OFL.txt`) も併せて配置しています。

### サブセット埋め込み

フォント全体は 5.3MB あり、そのまま埋め込むと出力 PDF が 3MB 増えます。実際に
使った文字だけを取り出す (サブセット化) ことで、**数KB程度**に抑えています。

ここには 1 つ落とし穴があります。`@pdf-lib/fontkit` (v1系) のサブセット生成は
CJK フォントで壊れたグリフを出力し、多くの漢字・かなが欠落します。そのため
**fontkit v2 のサブセット生成器**を使い、`pdf-lib` が期待する
`subset.encodeStream()` との差分だけをアダプタで吸収しています
(`src/lib/pdf/font.ts` の `createFontkitAdapter`)。

万一サブセット生成に失敗した場合は、`@pdf-lib/fontkit` でフォント全体を埋め込む
経路へ自動的に切り替わります。出力は重くなりますが文字化けはしません。

### フォントの取得タイミング

5MB 超あるため、PDF を開いてエディタを表示した時点で初めて取得します。トップ
画面を開いただけではダウンロードしません。

---

## プライバシー

- PDF ファイルはサーバーへ送信されません
- バックエンド API はありません。アプリは静的なフロントエンドのみです
- ファイルの読み込み・編集・書き出しはすべてブラウザのメモリ上で行われます
  (`File` / `ArrayBuffer` / `Uint8Array` / `Blob`)
- 書き出した PDF は `Blob` URL 経由でダウンロードされ、URL は使用後に解放されます
- 外部の解析サービスやトラッキングは含まれていません

---

## 現在の制限

- **元 PDF に元からある文字は編集できません。** 追加した編集レイヤーのみが対象です
- 追加できる要素はテキストのみです (画像・図形は未対応)
- パスワード保護された PDF は開けません
- ページの並び替えはできません
- ページを回転しても、そのページ上の編集テキストは画面上の相対位置に留まります
  (ページ内容と一緒には回りません)
- 太字・斜体などのフォントスタイルは選べません (Regular のみ)
- 文字の回転・透明度・縁取りには未対応です
- 編集内容はブラウザに保存されません。リロードすると失われます
- 右のプロパティパネルは画面幅 1024px 以上、左のサムネイルは 768px 以上で表示されます

---

## 動作確認

`fixtures/` 用の PDF を生成し、実ブラウザ (Chromium) でアプリを操作して検証する
スクリプトを同梱しています。プレビューと書き出し結果の**実描画ピクセル**を
突き合わせるため、位置ズレを見逃しません。

```bash
npx playwright install chromium   # 初回のみ
npm run fixtures                  # 検証用PDFを生成
npm run build && npm run start    # 別のターミナルで起動
npm run e2e
```

確認している内容:

| # | 項目 |
| --- | --- |
| 1 | 1ページPDFを読み込める |
| 2 | 複数ページPDFを読み込める |
| 3 | 日本語PDFを表示できる |
| 4 | テキストを追加できる |
| 5 | 日本語を入力できる (IME の変換確定を含む) |
| 6 | テキストをドラッグ移動できる |
| 7 | フォントサイズを変更できる |
| 8 | 文字色を変更できる |
| 9 | テキストを削除できる |
| 10 | 別ページにもテキストを追加できる |
| 11 | PDFを書き出せる |
| 12 | 出力PDFでテキスト位置がずれない (誤差 0.15% 未満) |
| 13 | 出力PDFで日本語が文字化けしない |
| 14 | 元PDFの内容が維持されている |
| 15 | 回転ページ / CropBoxオフセットPDFでも位置が一致する |
| 16 | Undo / Redo が動く |
| 17 | 複数行テキスト・ページ回転・ページ削除が出力に反映される |
| 18 | PDF以外 / 壊れたPDFでエラーが表示される |
| 19 | console エラー・未捕捉例外が出ない |

---

## ファイル構成

```text
src/
  app/
    layout.tsx
    page.tsx
    globals.css                 @font-face の定義を含む

  components/editor/
    PdfEditor.tsx               全体の状態を持つ司令塔
    DropZone.tsx                初期画面
    Header.tsx                  開く / PDF書き出し
    Toolbar.tsx                 ツール・Undo/Redo・ページ送り・ズーム
    PageSidebar.tsx             ページ一覧
    PageThumbnail.tsx           遅延描画されるサムネイル
    PdfCanvas.tsx               スクロール領域
    PdfPage.tsx                 canvas + 編集レイヤー + ドラッグ処理
    TextElementView.tsx         SVG のテキスト要素
    InlineTextEditor.tsx        その場入力用の textarea (IME 対応)
    PropertiesPanel.tsx         選択中要素のプロパティ
    StatusBanner.tsx            通知・エラー表示

  hooks/
    useEditorHistory.ts         Undo / Redo
    usePdfDocument.ts           ファイル読み込みと PDF.js の後始末
    useJapaneseFont.ts          日本語フォントの取得

  lib/pdf/
    renderPdf.ts                PDF.js の初期化と描画
    exportPdf.ts                pdf-lib による書き出し
    coordinates.ts              座標変換
    textLayout.ts               ベースライン計算 (プレビューと書き出しで共用)
    font.ts                     フォント読み込みと fontkit アダプタ
    errors.ts                   日本語エラーメッセージへの変換

  types/
    editor.ts

public/
  fonts/                        Noto Sans JP + ライセンス
  pdfjs/                        PDF.js の worker / CMap (postinstall で生成)

scripts/
  copy-pdfjs-assets.mjs         PDF.js の配布物を public へ複製
  make-fixtures.mjs             検証用PDFの生成
  e2e-check.mjs                 ブラウザでの動作確認
```

---

## 今後追加予定の機能

### Phase 2 — 編集要素とページ操作

- 画像の追加
- 四角形 / 円 / 線
- ハイライト
- フリーハンド描画
- ページ削除 / ページ回転の強化
- ページ並び替え
- PDF の結合
- PDF の分割

### Phase 3 — 既存コンテンツの編集

- **既存 PDF テキストの選択**
- **既存テキストの編集** (現在は未対応の中核機能)
- OCR
- スキャン PDF への対応

### Phase 4 — AI によるPDF編集

- 自然言語による編集命令
  - 「全ページにページ番号を追加」
  - 「この文章を簡潔にして」
  - 「このロゴを全ページ右上に追加」
- 文書要約
- PDF への質問応答

---

## ライセンス

同梱している Noto Sans JP は SIL Open Font License 1.1 で配布されています。
詳細は [`public/fonts/OFL.txt`](public/fonts/OFL.txt) および
[`public/fonts/README.md`](public/fonts/README.md) を参照してください。
