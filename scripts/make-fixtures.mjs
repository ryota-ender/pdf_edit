// 動作確認用の PDF を生成する開発用スクリプト。アプリ本体では使わない。
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import * as fontkit from "fontkit";

const outDir = process.argv[2] ?? "./fixtures";
await fs.mkdir(outDir, { recursive: true });

const fontBytes = await fs.readFile("public/fonts/NotoSansJP-Regular.ttf");

/** fontkit v2 を pdf-lib へ繋ぐアダプタ (src/lib/pdf/font.ts と同じ考え方)。 */
const adapter = {
  create(data) {
    const font = fontkit.create(data);
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      subset.encodeStream = () => {
        const h = {};
        const em = {
          on(event, handler) {
            h[event] = handler;
            return em;
          },
        };
        Promise.resolve().then(() => {
          try {
            h.data?.(new Uint8Array(subset.encode()));
            h.end?.();
          } catch (error) {
            h.error?.(error);
          }
        });
        return em;
      };
      return subset;
    };
    return font;
  },
};

async function write(name, doc) {
  const bytes = await doc.save();
  await fs.writeFile(path.join(outDir, name), bytes);
  console.log(`  ${name} (${(bytes.length / 1024).toFixed(1)}KB)`);
}

// 1) 1 ページ・A4・欧文のみ
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("Single Page Fixture", { x: 60, y: 760, size: 24, font });
  page.drawRectangle({
    x: 60,
    y: 60,
    width: 475,
    height: 680,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 1,
  });
  // 位置検証用の基準マーカー: 左下原点から (100, 100) に一辺 10 の四角。
  // 追加テキストの色 (赤) と混ざらないよう灰色にしておく。
  page.drawRectangle({
    x: 100,
    y: 100,
    width: 10,
    height: 10,
    color: rgb(0.5, 0.5, 0.5),
  });
  await write("single-page.pdf", doc);
}

// 2) 3 ページ・サイズ違い
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes = [
    [595.28, 841.89], // A4 縦
    [841.89, 595.28], // A4 横
    [612, 792], // Letter
  ];
  sizes.forEach(([w, h], index) => {
    const page = doc.addPage([w, h]);
    page.drawText(`Page ${index + 1}`, { x: 40, y: h - 60, size: 28, font });
  });
  await write("multi-page.pdf", doc);
}

// 3) 日本語を含む PDF
{
  const doc = await PDFDocument.create();
  doc.registerFontkit(adapter);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("研究計画書", { x: 60, y: 760, size: 28, font });
  page.drawText("映像検索システムに関する考察", { x: 60, y: 710, size: 16, font });
  page.drawText("これは既存の日本語テキストです。", { x: 60, y: 670, size: 12, font });
  await write("japanese.pdf", doc);
}

// 4) /Rotate 90 のページを含む PDF
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const a = doc.addPage([595.28, 841.89]);
  a.drawText("Rotated 90", { x: 40, y: 780, size: 24, font });
  a.setRotation(degrees(90));
  const b = doc.addPage([595.28, 841.89]);
  b.drawText("Rotated 270", { x: 40, y: 780, size: 24, font });
  b.setRotation(degrees(270));
  await write("rotated.pdf", doc);
}

// 5) MediaBox / CropBox の原点が (0,0) でない PDF
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.setMediaBox(20, 30, 500, 700);
  page.setCropBox(20, 30, 500, 700);
  page.drawText("Offset CropBox", { x: 60, y: 680, size: 20, font });
  await write("offset-cropbox.pdf", doc);
}

console.log(`fixtures written to ${outDir}`);
