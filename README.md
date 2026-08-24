# PDF Editor

ブラウザだけで動く PDF 注釈エディタです。PDF を読み込み、テキスト・ハイライト・
図形・フリーハンド・画像を重ねて、編集内容を焼き込んだ PDF として書き出せます。

**PDF はサーバーへアップロードされません。** 読み込みから書き出しまで、すべての処理が
お使いのブラウザ内で完結します。バックエンドはありません。

---

## 画面構成

```text
┌──────────────────────────────────────────────────────────────────┐
│ ファイル名 │ 履歴 │ ページ送り │ 表示倍率 │        開く  PDF書き出し │
├────┬──────────┬────────────────────────────────┬─────────────────┤
│ ツ │ ページ    │                                │ プロパティ       │
│ ー │ [1]      │   ページ1                       │                 │
│ ル │ [2]      │   ページ2  ← 全ページを連続表示   │ 選択中の要素に   │
│ 　 │ [3]      │   ページ3                       │ 応じて中身が変化 │
└────┴──────────┴────────────────────────────────┴─────────────────┘
```

一般的な PDF ビューアと同じく **全ページを縦に連続表示** します。描画は各ページが
画面に入ったときだけ行われるので、ページ数の多い PDF でも開いた瞬間に固まりません。

---

## 機能

### 編集ツール

| ツール | ショートカット | 操作 |
| --- | --- | --- |
| 選択 | `V` | クリックで選択、ドラッグで移動、余白のドラッグで範囲選択 |
| テキスト | `T` | クリックした位置にその場で入力（日本語 IME 対応） |
| ハイライト | `H` | ドラッグ。乗算合成なので下の文字が透ける |
| フリーハンド | `P` | ドラッグでなぞり書き |
| 四角形 | `R` | ドラッグ。角丸・塗り・枠線を設定できる |
| 円 | `O` | ドラッグ |
| 矢印 | `A` | ドラッグ。先端の有無を切り替え可 |
| 画像 | `I` | クリックして PNG / JPEG を配置 |

### 直接操作

- ドラッグで移動（`Shift` で水平・垂直に固定）
- 8 方向のハンドルでリサイズ（`Shift` で縦横比を保持）
- 矢印は両端のハンドルで向きと長さを変更
- テキストはリサイズでフォントサイズが拡大縮小（文字が折り返さないので位置が崩れない）
- 範囲選択・`Shift` クリックでの複数選択、まとめて移動・削除
- 矢印キーで微調整（`Shift` で大きく移動）
- 描画中に `Shift` で正方形 / 正円 / 45度スナップ

### ページ管理

ページ一覧から、回転・複製・削除・並べ替えができます。ページを動かすと、
そのページに載っている編集要素も一緒に付いていきます。

### 表示

- 幅に合わせる / 全体表示 / 25%〜300%
- `Cmd/Ctrl + ホイール` でズーム
- ページ一覧の表示切り替え

### キーボードショートカット

| キー | 動作 |
| --- | --- |
| `V` `T` `H` `P` `R` `O` `A` `I` | ツール切り替え |
| `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` | 元に戻す / やり直す |
| `Cmd/Ctrl + A` | 表示中のページの要素を全選択 |
| `Cmd/Ctrl + C` / `Cmd/Ctrl + V` | コピー / 貼り付け |
| `Cmd/Ctrl + D` | 複製 |
| `Delete` / `Backspace` | 削除 |
| `Escape` | 選択解除・編集終了 |
| `Cmd/Ctrl + Enter` | テキスト入力を確定 |
| 矢印キー | 微調整 |

### 書き出し

元 PDF に編集レイヤーを焼き込んだ新しい PDF を生成し、`<元のファイル名>-edited.pdf`
としてダウンロードします。

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

状態管理は React の state とカスタムフックのみです。ドラッグ・リサイズ・範囲選択も
Pointer Events による自前実装で、外部ライブラリは使っていません。

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
npm run dev      # http://localhost:3000
```

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
Page Container (position: relative)
 ├── <canvas>            PDF.js が描画した元ページ（読み取り専用）
 ├── <svg>               編集レイヤー
 │    ├── 要素           text / rect / ellipse / line / path / image
 │    ├── 当たり判定      細い線でも掴めるよう、見た目とは別に用意
 │    └── 選択枠とハンドル
 └── <textarea>          テキスト入力中だけ現れる
```

編集レイヤーを SVG にしているのは **位置精度のため** です。SVG の `<text>` は
`y` 座標がそのままベースラインになり、これは PDF の描画モデルと同じです。
HTML の `<div>` で文字を置くと、ベースライン位置がブラウザの `line-height` 解釈や
OS ごとのフォントメトリクス選択に左右され、環境によって位置がずれます。

SVG の `viewBox` は PDF ポイント単位にしてあります。ズームは SVG のスケールだけで
吸収されるため、**内部の座標値はズーム率に一切依存しません**。

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
  color: string;
  align: "left" | "center" | "right";
  opacity: number;
};
```

座標はピクセルではなく **ページ幅・高さに対する比率 (0〜1)** で保持します。
ウィンドウサイズを変えてもズーム率を変えても位置はずれません。線の太さや
フォントサイズは PDF ポイントで持つので、こちらもズームに依存しません。

画像の実体（バイト列）は編集履歴に載せず、`ImageAssetStore` が別に保持します。
Undo のたびに数 MB をコピーしないためです。要素側は `assetId` だけを持ちます。

Undo / Redo の対象は「ページ構成 + 全要素」をまとめた 1 つのオブジェクトなので、
要素の編集だけでなくページの削除・回転・並べ替えも元に戻せます。

---

## 座標変換の仕組み

3 つの座標系があります。

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

### 2. テキスト: 上端 → ベースライン

`y` はテキストブロックの上端です。PDF の `drawText` はベースライン基準なので、
フォントのアセントぶん下げます。

```ts
baselineY = viewY + ascentRatio * fontSize;
```

`ascentRatio` は fontkit で実フォントから読んだ値（Noto Sans JP なら 1.16）です。
2 行目以降は `LINE_HEIGHT_FACTOR (1.25) × fontSize` ずつ下がります。この計算は
プレビューと書き出しで同じ関数（`src/lib/pdf/textLayout.ts`）を使うため、必ず一致します。

### 3. ビュー座標 → PDF ユーザー空間

Y の反転に加えて、ページ回転と CropBox の原点オフセットを考慮します。

```ts
// 回転 0° の場合
pdfX = cropBox.x + viewX;
pdfY = cropBox.y + (cropBox.height - viewY);
```

90° / 180° / 270° 回転したページでは軸の対応が入れ替わります
（`src/lib/pdf/coordinates.ts` の `viewPointToPdfPoint`）。MediaBox / CropBox の原点が
`(0, 0)` でない PDF でも正しい位置に描けるよう、CropBox のオフセットを加算しています。

### 4. 図形ごとの書き出し

| 要素 | pdf-lib の呼び出し | 補足 |
| --- | --- | --- |
| テキスト | `drawText` | 行揃えは行ごとに開始位置をずらして表現 |
| ハイライト | `drawRectangle` | `BlendMode.Multiply` で下の文字を透かす |
| 四角形 / 円 | `drawRectangle` / `drawEllipse` | 4 隅を変換して外接矩形を取る |
| 矢印 | `drawLine` + `drawSvgPath` | 先端の三角形はパスで描く |
| フリーハンド | `drawSvgPath` | 丸い線端・線結合を明示 |
| 画像 | `drawImage` | ページ回転に合わせて原点を補正 |

`drawSvgPath` は内部で `translate → rotate → scale(1, -1)` を適用します。つまり
`x=0, y=0, scale=1` で呼べば、パス上の点 `(px, py)` は PDF 座標 `(px, -py)` に落ちます。
そこで **自前で PDF 座標へ変換した点の Y を反転して** 書き出すことで、ページ回転を
含めた変換結果をそのまま使えるようにしています。

### 精度

自動確認スクリプトで、プレビューの実描画ピクセルと書き出した PDF の実描画ピクセルを
突き合わせています。**ズレはページ寸法の 0.2% 未満**（A4 で 1pt 前後）です。
回転ページ・CropBox オフセットありの PDF でも同じ精度です。

---

## 日本語対応

`pdf-lib` の標準 14 フォントは日本語を持たないため、Noto Sans JP を PDF へ
埋め込んでいます。フォントは `public/fonts/` に同梱し、ライセンス全文
（`OFL.txt`）も併せて配置しています。

### サブセット埋め込み

フォント全体は 5.3MB あり、そのまま埋め込むと出力 PDF が 3MB 増えます。実際に
使った文字だけを取り出す（サブセット化）ことで、**数KB程度**に抑えています。

ここには落とし穴があります。`@pdf-lib/fontkit`（v1系）のサブセット生成は CJK
フォントで壊れたグリフを出力し、多くの漢字・かなが欠落します。そのため
**fontkit v2 のサブセット生成器**を使い、`pdf-lib` が期待する
`subset.encodeStream()` との差分だけをアダプタで吸収しています
（`src/lib/pdf/font.ts` の `createFontkitAdapter`）。

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
  （`File` / `ArrayBuffer` / `Uint8Array` / `Blob`）
- 貼り付けた画像も同様で、Blob URL は破棄時に解放されます
- 書き出した PDF は Blob URL 経由でダウンロードされ、URL は使用後に解放されます
- 外部の解析サービスやトラッキングは含まれていません

---

## 現在の制限

- **元 PDF に元からある文字は編集できません。** 追加した編集レイヤーのみが対象です
- パスワード保護された PDF は開けません
- 太字・斜体は選べません（Noto Sans JP Regular のみ）
- 要素そのものの回転には未対応です（ページの回転は可能）
- 要素の重なり順は追加した順で固定です
- テキストは自動で折り返しません。改行は手動で入れてください
- ページを回転しても、そのページ上の要素は画面上の相対位置に留まります
  （ページ内容と一緒には回りません）
- ページを並べ替え・複製・削除すると、しおりやフォームは引き継がれません
  （並びを変えていない場合は元の文書構造をそのまま保ちます）
- 編集内容はブラウザに保存されません。リロードすると失われます
- 画面幅 1280px 以上での利用を想定しています

---

## 動作確認

検証用 PDF を生成し、実ブラウザ (Chromium) でアプリを操作して確認するスクリプトを
同梱しています。プレビューと書き出し結果の **実描画ピクセル** を突き合わせるため、
位置ズレを見逃しません。

```bash
npx playwright install chromium   # 初回のみ
npm run fixtures                  # 検証用PDFを生成
npm run build && npm run start    # 別のターミナルで起動
npm run e2e
```

確認している内容（全 48 項目）:

| 分類 | 項目 |
| --- | --- |
| 読み込み | 1ページ / 複数ページ / 日本語 / ドラッグ&ドロップ |
| テキスト | 追加・日本語入力・IME変換確定・位置の一致 |
| 図形 | 四角形 / 円 / 矢印 / フリーハンド / ハイライトの描画と位置の一致 |
| ハイライト | 乗算合成で下の文字が読めること |
| 画像 | 貼り付けと書き出しへの反映 |
| 直接操作 | 移動 / リサイズ / 微調整 / 複製 / 範囲選択 / まとめて削除 / Undo / Redo |
| ページ | 連続表示 / ページ送り / 複製 / 並べ替えと出力への反映 |
| 特殊なPDF | 回転ページ / CropBoxオフセット |
| エラー | PDF以外 / 壊れたPDF |
| 品質 | consoleエラー・未捕捉例外が出ないこと |

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
    AppHeader.tsx               ファイル操作・履歴・倍率・ページ送り
    ToolRail.tsx                左端の縦型ツールバー
    PageRail.tsx                ページ一覧とページ操作
    PageThumbnail.tsx           遅延描画されるサムネイル
    DocumentView.tsx            全ページを縦に並べるスクロール領域
    PdfPageView.tsx             canvas + 編集レイヤー + 各種ドラッグ操作
    ElementView.tsx             要素の SVG 描画
    SelectionLayer.tsx          選択枠とリサイズハンドル
    InlineTextEditor.tsx        その場入力用の textarea (IME 対応)
    Inspector.tsx               選択中の要素に応じたプロパティ欄
    StatusBanner.tsx            通知・エラー表示
    Icons.tsx                   アイコン

  hooks/
    useEditorHistory.ts         Undo / Redo
    usePdfDocument.ts           ファイル読み込みと PDF.js の後始末
    useJapaneseFont.ts          日本語フォントの取得

  lib/pdf/
    renderPdf.ts                PDF.js の初期化と描画
    exportPdf.ts                pdf-lib による書き出し
    coordinates.ts              座標変換
    textLayout.ts               ベースライン計算 (プレビューと書き出しで共用)
    geometry.ts                 外接矩形・リサイズ・当たり判定
    elementDefaults.ts          要素の生成と初期値
    imageAssets.ts              貼り付けた画像の保管
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

### Phase 2 — 仕上げ

- 要素の重なり順の変更（前面へ / 背面へ）
- 要素そのものの回転
- 太字・斜体（フォントウェイトの追加）
- テキストの自動折り返し
- 図形のスナップ・整列ガイド
- PDF の結合 / 分割
- 編集内容の一時保存（リロード復帰）

### Phase 3 — 既存コンテンツの編集

- **既存 PDF テキストの選択**
- **既存テキストの編集**（現在は未対応の中核機能）
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
