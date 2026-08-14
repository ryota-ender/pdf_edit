# 同梱フォントについて

## NotoSansJP-Regular.ttf

- 書体名: Noto Sans JP (Regular / 400)
- 配布元: [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+JP)
- ライセンス: SIL Open Font License 1.1 — 全文は [`OFL.txt`](./OFL.txt)

Noto Sans CJK は Adobe の Source Han Sans を基にしているため、`OFL.txt` の
著作権表記は Adobe 名義になっています。これが Google Fonts が配布している
`ofl/notosansjp/OFL.txt` の正しい内容です。

## なぜ同梱しているか

このアプリは PDF をサーバーへ送らずブラウザ内だけで処理します。日本語を
PDF へ書き込むにはフォントの実体を埋め込む必要があるため、再配布可能な
フォントをアプリ自身が配信しています。

同じファイルを 2 つの用途で使っています。

1. `@font-face` によるプレビュー表示 (`src/app/globals.css`)
2. `pdf-lib` によるPDFへの埋め込み (`src/lib/pdf/exportPdf.ts`)

同一のフォント・同一のメトリクスで文字送りを計算することで、画面上の
文字位置と書き出した PDF の文字位置を一致させています。

## 差し替える場合

OFL などで再配布が認められた別の日本語フォントに差し替えられます。

1. TTF (TrueType) をこのディレクトリへ置く
2. ライセンス全文を同じディレクトリへ置く
3. `src/lib/pdf/font.ts` の `FONT_URL` を変更する
4. `src/app/globals.css` の `@font-face` の `src` を変更する

OTF (CFF アウトライン) や可変フォントはサブセット生成に失敗することが
あるため、静的な TTF を推奨します。
