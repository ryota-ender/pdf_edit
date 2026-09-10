// 検証用に、RC4 40bit で保護された PDF を作る開発用スクリプト。
// pdf-lib は暗号化 PDF を書けないため、標準セキュリティハンドラ
// (リビジョン 2) を素の PDF 構文で組み立てる。
import fs from "node:fs/promises";
import crypto from "node:crypto";

const OUT = process.argv[2] ?? "./fixtures/encrypted.pdf";
const USER_PASSWORD = process.argv[3] ?? "secret";

/** 仕様で決められた 32 バイトの詰め物。 */
const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (...parts) =>
  crypto.createHash("md5").update(Buffer.concat(parts)).digest();

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const pad = (password) =>
  Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);

// 権限フラグ: 印刷・コピーなどを許可する一般的な値。
const P = -1;
const pBytes = Buffer.alloc(4);
pBytes.writeInt32LE(P, 0);
const fileId = crypto.randomBytes(16);

// アルゴリズム 3: 所有者パスワードの項目 /O
const ownerKey = md5(pad(USER_PASSWORD)).subarray(0, 5);
const O = rc4(ownerKey, pad(USER_PASSWORD));

// アルゴリズム 2: 暗号化キー
const encryptionKey = md5(pad(USER_PASSWORD), O, pBytes, fileId).subarray(0, 5);

// アルゴリズム 4: 利用者パスワードの項目 /U (リビジョン 2)
const U = rc4(encryptionKey, PAD);

/** オブジェクト番号ごとの鍵を作って暗号化する。 */
function encryptFor(objectNumber, generation, data) {
  const extra = Buffer.from([
    objectNumber & 0xff,
    (objectNumber >> 8) & 0xff,
    (objectNumber >> 16) & 0xff,
    generation & 0xff,
    (generation >> 8) & 0xff,
  ]);
  const key = md5(encryptionKey, extra).subarray(
    0,
    Math.min(encryptionKey.length + 5, 16),
  );
  return rc4(key, data);
}

const contentStream = Buffer.from(
  "BT /F1 24 Tf 60 720 Td (Protected Document) Tj ET",
  "latin1",
);
const encryptedContent = encryptFor(4, 0, contentStream);

const objects = [
  `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
  `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
  `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ` +
    `/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  null, // 4 0 obj はバイナリを含むので後で組み立てる
  `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  `6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${O.toString("hex")}> ` +
    `/U <${U.toString("hex")}> /P ${P} >>\nendobj\n`,
];

const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
const offsets = [0];

for (let i = 0; i < objects.length; i += 1) {
  offsets.push(chunks.reduce((sum, c) => sum + c.length, 0));
  if (i === 3) {
    chunks.push(
      Buffer.from(`4 0 obj\n<< /Length ${encryptedContent.length} >>\nstream\n`, "latin1"),
      encryptedContent,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    );
  } else {
    chunks.push(Buffer.from(objects[i], "latin1"));
  }
}

const xrefOffset = chunks.reduce((sum, c) => sum + c.length, 0);
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i += 1) {
  xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
xref +=
  `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R ` +
  `/ID [<${fileId.toString("hex")}> <${fileId.toString("hex")}>] >>\n` +
  `startxref\n${xrefOffset}\n%%EOF\n`;

chunks.push(Buffer.from(xref, "latin1"));

await fs.writeFile(OUT, Buffer.concat(chunks));
console.log(`${OUT} written (password: ${USER_PASSWORD})`);
