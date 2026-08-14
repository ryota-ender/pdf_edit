import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
const bytes = fs.readFileSync('/private/tmp/claude-501/-Users-ryota-ender-prog/1ef8ba36-52ed-4efb-ad94-24272d697fa6/scratchpad/NotoSansJP-Regular.ttf');
const f = fontkit.create(bytes);
console.log('head.indexToLocFormat =', f.head.indexToLocFormat, ' numGlyphs =', f.numGlyphs);
for (const ch of 'こんにちは研究計画書C字') {
  const g = f.glyphForCodePoint(ch.codePointAt(0));
  let isComposite = false;
  try { isComposite = g._getPath && g._decode && !!g._decode().components; } catch {}
  console.log(ch, 'gid=' + g.id, 'composite=' + isComposite);
}
