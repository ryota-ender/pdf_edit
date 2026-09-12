import { PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from "pdf-lib";
import type { asn1 as ForgeAsn1 } from "node-forge";
import type { PDFDocument, PDFPage, PDFRef } from "pdf-lib";
import { PdfEditorError } from "./errors";

/**
 * 電子署名（PAdES 相当の detached PKCS#7）
 * ------------------------------------------------------------------
 * 手順は次のとおり。
 *   1. 署名欄と署名辞書を作る。/Contents には決まった長さの空き枠を置く
 *   2. いったん保存して、空き枠の位置を実バイト列から探す
 *   3. 空き枠を除いた範囲 (/ByteRange) のハッシュを取る
 *   4. そのハッシュに対する detached CMS を作り、空き枠へ流し込む
 *
 * 署名に使う鍵と証明書はブラウザ内で扱い、どこへも送信しない。
 * 自己署名の証明書は「改ざんの有無は検証できるが、署名者の身元は
 * 保証されない」状態になる点に注意（ビューアでは「不明」と表示される）。
 */

/** 署名に使う鍵と証明書。 */
export interface SigningCredential {
  /** PEM 形式の秘密鍵。 */
  privateKeyPem: string;
  /** PEM 形式の証明書。 */
  certificatePem: string;
  /** 表示名。 */
  commonName: string;
}

export interface SignatureOptions {
  credential: SigningCredential;
  /** 署名欄を置くページ（0 始まり）。 */
  pageIndex: number;
  /** 署名欄の位置（PDFユーザー空間）。 */
  rect: { x: number; y: number; width: number; height: number };
  reason?: string;
  location?: string;
  contactInfo?: string;
}

/** /Contents に確保する空き枠の大きさ（バイト）。 */
const SIGNATURE_PLACEHOLDER_BYTES = 8192;

/** ByteRange を後から書き換えられるよう、桁数に余裕のある初期値を置く。 */
const BYTE_RANGE_PLACEHOLDER = 9999999999;

type ForgeModule = typeof import("node-forge");

let forgePromise: Promise<ForgeModule> | null = null;

async function loadForge(): Promise<ForgeModule> {
  forgePromise ??= import("node-forge").then((mod) => mod.default ?? mod);
  return forgePromise;
}

/**
 * ブラウザ内で自己署名の証明書を作る。
 * 手元で「改ざん検知つきの署名」を試すためのもの。
 */
export async function createSelfSignedCredential(
  commonName: string,
  organization = "PDF Editor",
): Promise<SigningCredential> {
  const forge = await loadForge();

  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${Date.now().toString(16)}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 3);

  // 日本語の名前を入れるので UTF8String として書く。既定の
  // PrintableString だと node-forge が長さをバイト数で数えられず、
  // 出来上がった証明書が読めなくなる（forge 側が UTF-8 へ変換する）。
  // `@types/node-forge` は valueTagClass を asn1.Class と宣言しているが、
  // 実装が見ているのは asn1.Type（UTF8 = 12）。実挙動に合わせて渡す。
  const attrs = [
    {
      name: "commonName",
      value: commonName,
      valueTagClass: forge.asn1.Type.UTF8 as unknown as ForgeAsn1.Class,
    },
    {
      name: "organizationName",
      value: organization,
      valueTagClass: forge.asn1.Type.UTF8 as unknown as ForgeAsn1.Class,
    },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
    commonName,
  };
}

/** PKCS#12 (.p12 / .pfx) から鍵と証明書を取り出す。 */
export async function readPkcs12(
  bytes: Uint8Array,
  password: string,
): Promise<SigningCredential> {
  const forge = await loadForge();

  try {
    const binary = forge.util.createBuffer(
      String.fromCharCode(...Array.from(bytes)),
    );
    const asn1 = forge.asn1.fromDer(binary);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

    const keyBags =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] ?? [];
    const certBags =
      p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ??
      [];

    const key = keyBags[0]?.key;
    const cert = certBags[0]?.cert;
    if (!key || !cert) {
      throw new Error("鍵または証明書が見つかりません");
    }

    // 証明書の中では UTF-8 のバイト列として入っているので戻す。
    const rawName = cert.subject.getField("CN")?.value as string | undefined;
    let commonName = rawName ?? "署名者";
    try {
      if (rawName) commonName = forge.util.decodeUtf8(rawName);
    } catch {
      // ASCII の証明書はそのままで問題ない。
    }

    return {
      privateKeyPem: forge.pki.privateKeyToPem(key),
      certificatePem: forge.pki.certificateToPem(cert),
      commonName,
    };
  } catch (cause) {
    throw new PdfEditorError(
      "証明書ファイルを読み込めませんでした。パスワードをご確認ください。",
      { cause },
    );
  }
}

/**
 * 署名欄と署名辞書を文書へ足す。
 * 実際の署名値は保存後に `injectSignature` で流し込む。
 */
export function prepareSignature(
  pdfDoc: PDFDocument,
  options: SignatureOptions,
  appearanceRef: PDFRef | null,
): void {
  const page: PDFPage | undefined = pdfDoc.getPages()[options.pageIndex];
  if (!page) {
    throw new PdfEditorError("署名を置くページが見つかりませんでした。");
  }

  const now = new Date();
  const signatureDict = pdfDoc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    // 実バイト列から探せるよう、決まった長さの空き枠を置く。
    Contents: PDFHexString.of("0".repeat(SIGNATURE_PLACEHOLDER_BYTES * 2)),
    ByteRange: [
      0,
      BYTE_RANGE_PLACEHOLDER,
      BYTE_RANGE_PLACEHOLDER,
      BYTE_RANGE_PLACEHOLDER,
    ],
    // 素の文字列は /Name として書かれてしまうので、明示的に文字列にする。
    Name: PDFHexString.fromText(options.credential.commonName),
    M: PDFString.of(pdfDate(now)),
    ...(options.reason
      ? { Reason: PDFHexString.fromText(options.reason) }
      : {}),
    ...(options.location
      ? { Location: PDFHexString.fromText(options.location) }
      : {}),
    ...(options.contactInfo
      ? { ContactInfo: PDFHexString.fromText(options.contactInfo) }
      : {}),
  }) as PDFDict;

  const signatureRef = pdfDoc.context.register(signatureDict);

  const widget = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    // 署名欄は印刷され、かつ読み取り専用。
    F: 132,
    Rect: [
      options.rect.x,
      options.rect.y,
      options.rect.x + options.rect.width,
      options.rect.y + options.rect.height,
    ],
    T: PDFString.of(`Signature_${now.getTime()}`),
    V: signatureRef,
    P: page.ref,
    ...(appearanceRef ? { AP: { N: appearanceRef } } : {}),
  }) as PDFDict;

  const widgetRef = pdfDoc.context.register(widget);
  page.node.addAnnot(widgetRef);

  // AcroForm へ署名欄を登録する。既存のフォームがあれば足すだけ。
  const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm) {
    const fields = acroForm.lookup(PDFName.of("Fields"));
    if (fields && "push" in fields) {
      (fields as { push: (ref: PDFRef) => void }).push(widgetRef);
    }
    // 3 = 署名欄あり + 追記のみ許可。
    acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  } else {
    pdfDoc.catalog.set(
      PDFName.of("AcroForm"),
      pdfDoc.context.obj({ Fields: [widgetRef], SigFlags: 3 }),
    );
  }
}

/**
 * 保存済みのバイト列へ実際の署名値を流し込む。
 *
 * `/Contents` の空き枠を探し、そこを除いた範囲を `/ByteRange` として
 * 書き込んでから、その範囲の detached CMS を作って枠へ入れる。
 */
export async function injectSignature(
  saved: Uint8Array,
  credential: SigningCredential,
): Promise<Uint8Array> {
  const forge = await loadForge();
  const bytes = new Uint8Array(saved);

  // --- 空き枠の位置を探す ------------------------------------------
  const text = latin1(bytes);
  const contentsKey = "/Contents <";
  const keyIndex = text.indexOf(contentsKey);
  if (keyIndex === -1) {
    throw new PdfEditorError("署名の枠が見つかりませんでした。");
  }

  const hexStart = keyIndex + contentsKey.length - 1; // '<' の位置
  const hexEnd = text.indexOf(">", hexStart);
  if (hexEnd === -1) {
    throw new PdfEditorError("署名の枠が壊れています。");
  }
  const afterHex = hexEnd + 1;

  // --- ByteRange を書き込む ----------------------------------------
  const byteRange = [0, hexStart, afterHex, bytes.length - afterHex];
  const rangeStart = text.indexOf("/ByteRange");
  if (rangeStart === -1) {
    throw new PdfEditorError("ByteRange が見つかりませんでした。");
  }
  const rangeEnd = text.indexOf("]", rangeStart) + 1;
  const original = text.slice(rangeStart, rangeEnd);
  let replacement = `/ByteRange [${byteRange.join(" ")}]`;
  if (replacement.length > original.length) {
    throw new PdfEditorError("ByteRange の書き込み枠が足りませんでした。");
  }
  // 長さを変えるとオフセットが狂うので、空白で埋めて同じ長さにする。
  replacement = replacement.padEnd(original.length, " ");
  for (let i = 0; i < replacement.length; i += 1) {
    bytes[rangeStart + i] = replacement.charCodeAt(i);
  }

  // --- 署名対象のバイト列を組み立てる ------------------------------
  const signable = new Uint8Array(byteRange[1] + byteRange[3]);
  signable.set(bytes.subarray(0, byteRange[1]), 0);
  signable.set(bytes.subarray(byteRange[2]), byteRange[1]);

  // --- detached CMS を作る -----------------------------------------
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(latin1(signable));
  p7.addCertificate(credential.certificatePem);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(credential.privateKeyPem),
    certificate: credential.certificatePem,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  // detached = 中身そのものは署名に含めない。
  p7.sign({ detached: true });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = Array.from(der)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");

  const capacity = hexEnd - (hexStart + 1);
  if (hex.length > capacity) {
    throw new PdfEditorError(
      "署名データが枠に収まりませんでした。証明書が大きすぎる可能性があります。",
    );
  }

  // --- 空き枠へ流し込む --------------------------------------------
  const padded = hex.padEnd(capacity, "0");
  for (let i = 0; i < padded.length; i += 1) {
    bytes[hexStart + 1 + i] = padded.charCodeAt(i);
  }

  return bytes;
}

/** バイト列を latin1 の文字列として読む（位置合わせのため 1 バイト = 1 文字）。 */
function latin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

/** PDF の日付文字列 (D:YYYYMMDDHHmmSS+09'00')。 */
function pdfDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);

  return (
    `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}'${pad(absolute % 60)}'`
  );
}
