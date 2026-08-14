import fs from 'node:fs';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import * as fontkit2 from 'fontkit';

const SCRATCH='/private/tmp/claude-501/-Users-ryota-ender-prog/1ef8ba36-52ed-4efb-ad94-24272d697fa6/scratchpad';
const bytes = fs.readFileSync(SCRATCH + '/NotoSansJP-Regular.ttf');
const samples = ['こんにちは','研究計画書','映像検索システム','Hello ABC 123','漢字カタカナひらがな｜、。「」'];

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit2.default ?? fontkit2);
const font = await doc.embedFont(bytes, { subset: true });
const page = doc.addPage([595.28, 841.89]);
let y = 780;
for (const s of samples) { page.drawText(s, { x: 50, y, size: 24, font, color: rgb(0.1,0.1,0.1) }); y -= 40; }
page.drawText('回転テスト', { x: 300, y: 400, size: 20, font, rotate: degrees(90) });
const out = await doc.save();
fs.writeFileSync(`${SCRATCH}/out-fk2-subset.pdf`, out);
console.log('fontkit v2 subset OK, size =', (out.length/1024).toFixed(1), 'KB');
console.log('widthOfTextAtSize(こんにちは,24) =', font.widthOfTextAtSize('こんにちは',24));
