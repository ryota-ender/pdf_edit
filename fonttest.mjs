import fs from 'node:fs';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const SCRATCH = '/private/tmp/claude-501/-Users-ryota-ender-prog/1ef8ba36-52ed-4efb-ad94-24272d697fa6/scratchpad';
const bytes = fs.readFileSync(SCRATCH + '/NotoSansJP-Regular.ttf');

// 1) raw fontkit metrics
const fk = fontkit.create(bytes);
console.log('fontkit:', {
  postscriptName: fk.postscriptName,
  unitsPerEm: fk.unitsPerEm,
  ascent: fk.ascent,
  descent: fk.descent,
  lineGap: fk.lineGap,
  hasFvar: !!fk.variationAxes && Object.keys(fk.variationAxes || {}).length > 0,
  numGlyphs: fk.numGlyphs,
});
const run = fk.layout('こんにちは');
console.log('advance こんにちは @1000upm:', run.advanceWidth);

// 2) pdf-lib embed with subset
for (const subset of [true, false]) {
  try {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(bytes, { subset });
    const page = doc.addPage([595.28, 841.89]);
    const samples = ['こんにちは', '研究計画書', '映像検索システム', 'Hello ABC 123', '漢字カタカナひらがな｜、。「」'];
    let y = 780;
    for (const s of samples) {
      page.drawText(s, { x: 50, y, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 40;
    }
    page.drawText('回転テスト', { x: 300, y: 400, size: 20, font, rotate: degrees(90) });
    const out = await doc.save();
    fs.writeFileSync(`${SCRATCH}/out-subset-${subset}.pdf`, out);
    console.log(`subset=${subset} OK, size=${(out.length/1024).toFixed(1)}KB, widthOfTextAtSize('こんにちは',24)=${font.widthOfTextAtSize('こんにちは',24).toFixed(2)}, heightAtSize(24)=${font.heightAtSize(24).toFixed(2)}`);
  } catch (e) {
    console.log(`subset=${subset} FAILED:`, e.message);
  }
}
