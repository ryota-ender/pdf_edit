// 開発用の動作確認スクリプト。実ブラウザでアプリを操作し、
// 「プレビューの文字位置」と「書き出した PDF の文字位置」が一致するかを
// 実際のピクセルで突き合わせる。
//
//   node scripts/e2e-check.mjs <baseUrl> <fixtureDir> <outDir>
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:3111";
const FIXTURES = process.argv[3] ?? "./fixtures";
const OUT = process.argv[4] ?? "./e2e-out";

const PDFJS_MAIN = "node_modules/pdfjs-dist/build/pdf.min.mjs";
/** 追加テキストの色。元 PDF の黒い文字と区別するため赤にする。 */
const MARK_COLOR = "#dc2626";

await fs.mkdir(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
const pageErrors = [];

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(String(error)));

// ---------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------
async function openFixture(name) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(
    path.join(FIXTURES, name),
  );
  await page.waitForSelector("svg[data-edit-layer]", { timeout: 30000 });
  // ページの初回レンダリング完了 (スピナー消滅) を待つ。
  await page.waitForFunction(
    () => !document.querySelector("main .animate-spin"),
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(300);
}

/** テキストツールでページ上をクリックし、文字を入力して確定する。 */
async function addText(text, position) {
  await page.getByRole("button", { name: "テキスト" }).click();
  const svg = page.locator("svg[data-edit-layer]").first();
  await svg.click({ position });
  await page.waitForSelector("textarea:focus", { timeout: 5000 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  // blur して確定。
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
}

/** @font-face のフォントが実際に使える状態になるまで待つ。 */
async function waitForFont() {
  await page.waitForFunction(
    () =>
      document.fonts.status === "loaded" ||
      Array.from(document.fonts).some(
        (face) =>
          face.family.includes("NotoSansJPEmbedded") &&
          face.status === "loaded",
      ),
    undefined,
    { timeout: 60000 },
  );
}

/**
 * 計測用にズームを 50% にする。
 * ページ全体がビューポートに収まらないとスクリーンショットが切れてしまうため。
 * ズームを変えても位置がずれないことの確認も兼ねている。
 */
async function setZoomForMeasurement() {
  await page.getByLabel("ズーム").selectOption("0.5");
  await page.waitForTimeout(500);
}

/** プロパティパネルで選択中要素の値を設定する。 */
async function setProperty(label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.blur();
  await page.waitForTimeout(120);
}

/** 追加した文字が実際に描かれている領域を、ページ矩形に対する比率で返す。 */
async function measurePreviewInk() {
  const box = await page.locator("svg[data-edit-layer]").first().boundingBox();
  const viewport = page.viewportSize();
  if (box.y + box.height > viewport.height || box.x + box.width > viewport.width) {
    throw new Error(
      `ページがビューポートに収まっていないため計測できません: ${JSON.stringify(box)}`,
    );
  }
  const shot = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  return page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return globalThis.__findRedInk(ctx, canvas.width, canvas.height);
  }, `data:image/png;base64,${shot.toString("base64")}`);
}

/** 書き出した PDF を pdf.js で描画し、赤い文字の領域を比率で返す。 */
async function measureExportedInk(pdfPath, pageIndex = 0) {
  const bytes = await fs.readFile(pdfPath);
  return page.evaluate(
    async ({ base64, pageIndex }) => {
      const raw = atob(base64);
      const data = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) data[i] = raw.charCodeAt(i);

      const doc = await globalThis.pdfjsLib.getDocument({
        data,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
        iccUrl: "/pdfjs/iccs/",
      }).promise;

      const pdfPage = await doc.getPage(pageIndex + 1);
      const viewport = pdfPage.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvas, viewport, background: "#ffffff" }).promise;

      const ink = globalThis.__findRedInk(ctx, canvas.width, canvas.height);
      const text = await pdfPage.getTextContent();
      return {
        ink,
        pageCount: doc.numPages,
        textItems: text.items.map((item) => item.str),
      };
    },
    { base64: bytes.toString("base64"), pageIndex },
  );
}

/** ページ内に赤ピクセル検出関数と pdf.js を用意する。 */
async function installHarness() {
  await page.addScriptTag({ path: PDFJS_MAIN, type: "module" });
  await page.waitForFunction(() => Boolean(globalThis.pdfjsLib), undefined, {
    timeout: 15000,
  });
  await page.evaluate(() => {
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "/pdfjs/pdf.worker.min.mjs";
  });
  await page.evaluate(() => {
    globalThis.__findRedInk = (ctx, width, height) => {
      const { data } = ctx.getImageData(0, 0, width, height);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (data[i] > 140 && data[i + 1] < 110 && data[i + 2] < 110) {
            count += 1;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (count === 0) return null;
      return {
        x0: minX / width,
        y0: minY / height,
        x1: (maxX + 1) / width,
        y1: (maxY + 1) / height,
        count,
      };
    };
  });
}

async function exportAndSave(fileName) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: "PDF書き出し" }).click(),
  ]);
  const target = path.join(OUT, fileName);
  await download.saveAs(target);
  return { target, suggested: download.suggestedFilename() };
}

// ---------------------------------------------------------------
// 1) 1 ページ PDF + 日本語テキスト + 位置一致
// ---------------------------------------------------------------
console.log("\n[1] 1ページPDF / 日本語入力 / 位置の一致");
await openFixture("single-page.pdf");
check("1ページPDFを読み込める", true);

await addText("こんにちは研究計画書", { x: 120, y: 200 });

// 位置と見た目を決め打ちして、比較を再現可能にする。
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).click();
await setProperty("フォントサイズ（数値）", 32);
await setProperty("X (%)", 20);
await setProperty("Y (%)", 30);
await waitForFont();
await setZoomForMeasurement();

await installHarness();
const previewInk = await measurePreviewInk();
check("プレビューに追加テキストが描画されている", previewInk !== null);

const exported = await exportAndSave("single-edited.pdf");
check(
  "出力ファイル名が <元名>-edited.pdf になる",
  exported.suggested === "single-page-edited.pdf",
  exported.suggested,
);

const exportedResult = await measureExportedInk(exported.target);
check("出力PDFに追加テキストが存在する", exportedResult.ink !== null);
check(
  "元PDFの内容が維持されている",
  exportedResult.textItems.join("").includes("Single Page Fixture"),
);
check(
  "出力PDFで日本語が文字化けしない",
  exportedResult.textItems.join("").includes("こんにちは研究計画書"),
  exportedResult.textItems.join(" | ").slice(0, 120),
);

if (previewInk && exportedResult.ink) {
  const dx0 = Math.abs(previewInk.x0 - exportedResult.ink.x0);
  const dy0 = Math.abs(previewInk.y0 - exportedResult.ink.y0);
  const dw =
    Math.abs(
      previewInk.x1 - previewInk.x0 - (exportedResult.ink.x1 - exportedResult.ink.x0),
    );
  const dh =
    Math.abs(
      previewInk.y1 - previewInk.y0 - (exportedResult.ink.y1 - exportedResult.ink.y0),
    );
  const tolerance = 0.006; // ページ寸法の 0.6% (A4 幅で約 3.5pt)
  check(
    "プレビューと出力の文字位置が一致する",
    dx0 < tolerance && dy0 < tolerance && dw < tolerance && dh < tolerance,
    `dx=${(dx0 * 100).toFixed(2)}% dy=${(dy0 * 100).toFixed(2)}% dW=${(dw * 100).toFixed(2)}% dH=${(dh * 100).toFixed(2)}%`,
  );
}

// ---------------------------------------------------------------
// 2) 複数ページ / ページ切り替え / 別ページへの追加
// ---------------------------------------------------------------
console.log("\n[2] 複数ページPDF / ページ切り替え");
await openFixture("multi-page.pdf");
check("複数ページPDFを読み込める", true);

await addText("1ページ目", { x: 100, y: 150 });
await page.getByRole("button", { name: "3ページ目を表示" }).click();
await page.waitForTimeout(600);
await addText("3ページ目のテキスト", { x: 100, y: 150 });
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).click();
await page.waitForTimeout(300);

const multi = await exportAndSave("multi-edited.pdf");
await installHarness();
const multiPage3 = await measureExportedInk(multi.target, 2);
check("ページ数が維持されている", multiPage3.pageCount === 3, `${multiPage3.pageCount}ページ`);
check(
  "別ページにもテキストを追加できる",
  multiPage3.textItems.join("").includes("3ページ目のテキスト"),
);
const multiPage1 = await measureExportedInk(multi.target, 0);
check(
  "1ページ目のテキストも保持されている",
  multiPage1.textItems.join("").includes("1ページ目"),
);

// ---------------------------------------------------------------
// 3) 日本語PDFの表示
// ---------------------------------------------------------------
console.log("\n[3] 日本語PDFの表示");
await openFixture("japanese.pdf");
check("日本語PDFを表示できる", true);
await page.screenshot({ path: path.join(OUT, "japanese-view.png") });

// ---------------------------------------------------------------
// 4) 回転ページ / CropBox オフセットでの位置一致
// ---------------------------------------------------------------
for (const [fixture, label] of [
  ["rotated.pdf", "回転ページ"],
  ["offset-cropbox.pdf", "CropBoxオフセット"],
]) {
  console.log(`\n[4] ${label}での位置の一致`);
  await openFixture(fixture);
  await addText("位置テスト", { x: 90, y: 120 });
  await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).click();
  await setProperty("フォントサイズ（数値）", 28);
  await setProperty("X (%)", 25);
  await setProperty("Y (%)", 40);
  await waitForFont();
  await setZoomForMeasurement();

  await installHarness();
  const preview = await measurePreviewInk();
  const out = await exportAndSave(`${fixture.replace(".pdf", "")}-edited.pdf`);
  const result = await measureExportedInk(out.target, 0);

  if (preview && result.ink) {
    const dx = Math.abs(preview.x0 - result.ink.x0);
    const dy = Math.abs(preview.y0 - result.ink.y0);
    check(
      `${label}でもプレビューと出力の位置が一致する`,
      dx < 0.008 && dy < 0.008,
      `dx=${(dx * 100).toFixed(2)}% dy=${(dy * 100).toFixed(2)}%`,
    );
  } else {
    check(`${label}でもプレビューと出力の位置が一致する`, false, "ink未検出");
  }
}

// ---------------------------------------------------------------
// 5) 編集操作 (移動 / サイズ / 色 / 削除 / Undo / Redo)
// ---------------------------------------------------------------
console.log("\n[5] 編集操作");
await openFixture("single-page.pdf");
await addText("編集テスト", { x: 100, y: 150 });

const readElement = () =>
  page.evaluate(() => {
    const textEl = document.querySelector("svg[data-edit-layer] text");
    const tspan = textEl?.querySelector("tspan");
    return {
      text: textEl?.textContent ?? null,
      fill: textEl?.getAttribute("fill") ?? null,
      fontSize: textEl?.getAttribute("font-size") ?? null,
      x: tspan?.getAttribute("x") ?? null,
      y: tspan?.getAttribute("y") ?? null,
    };
  });

const before = await readElement();

// 移動 (ドラッグ)
const svgBox = await page.locator("svg[data-edit-layer]").first().boundingBox();
await page.mouse.move(svgBox.x + 110, svgBox.y + 160);
await page.mouse.down();
await page.mouse.move(svgBox.x + 260, svgBox.y + 320, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(250);
const afterMove = await readElement();
check(
  "テキストをドラッグ移動できる",
  afterMove.x !== before.x && afterMove.y !== before.y,
  `x: ${before.x} → ${afterMove.x}`,
);

// サイズ変更
await setProperty("フォントサイズ（数値）", 48);
const afterSize = await readElement();
check("フォントサイズを変更できる", afterSize.fontSize === "48", afterSize.fontSize);

// 色変更
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).click();
await page.waitForTimeout(150);
const afterColor = await readElement();
check("文字色を変更できる", afterColor.fill === MARK_COLOR, afterColor.fill ?? "");

// Undo / Redo
await page.keyboard.press("ControlOrMeta+z");
await page.waitForTimeout(200);
const afterUndo = await readElement();
check("Undoで色変更が戻る", afterUndo.fill !== MARK_COLOR, afterUndo.fill ?? "");

await page.keyboard.press("ControlOrMeta+Shift+z");
await page.waitForTimeout(200);
const afterRedo = await readElement();
check("Redoで色変更が再適用される", afterRedo.fill === MARK_COLOR, afterRedo.fill ?? "");

// Undo で移動も戻る
await page.keyboard.press("ControlOrMeta+z"); // 色
await page.keyboard.press("ControlOrMeta+z"); // サイズ
await page.keyboard.press("ControlOrMeta+z"); // 移動
await page.waitForTimeout(300);
const afterUndoMove = await readElement();
check(
  "Undoで移動が戻る",
  afterUndoMove.x === before.x && afterUndoMove.y === before.y,
  `x: ${afterUndoMove.x} (期待 ${before.x})`,
);

// 削除
await page.locator("svg[data-edit-layer] rect").last().click();
await page.waitForTimeout(150);
await page.getByRole("button", { name: "削除", exact: true }).click();
await page.waitForTimeout(200);
const afterDelete = await readElement();
check("テキストを削除できる", afterDelete.text === null);

// ---------------------------------------------------------------
// 6) IME (composition) 経由の日本語入力
// ---------------------------------------------------------------
console.log("\n[6] IME入力");
await openFixture("single-page.pdf");
await page.getByRole("button", { name: "テキスト" }).click();
await page.locator("svg[data-edit-layer]").first().click({ position: { x: 120, y: 200 } });
await page.waitForSelector("textarea:focus");
await page.evaluate(() => {
  const textarea = document.activeElement;
  textarea.value = "";
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  ).set;
  setter.call(textarea, "にほんご");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  setter.call(textarea, "日本語入力");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true, data: "日本語入力" }),
  );
});
await page.waitForTimeout(200);
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(250);
const imeText = await page.evaluate(
  () => document.querySelector("svg[data-edit-layer] text")?.textContent ?? null,
);
check("IME変換確定の日本語が反映される", imeText === "日本語入力", String(imeText));

// ---------------------------------------------------------------
// 7) PDF以外のファイル
// ---------------------------------------------------------------
console.log("\n[7] エラーハンドリング");
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
const notPdf = path.join(OUT, "not-a-pdf.txt");
await fs.writeFile(notPdf, "this is not a pdf");
await page.locator('input[type="file"]').first().setInputFiles(notPdf);
await page.waitForTimeout(500);
const alertText = await page.locator('[role="alert"]').first().textContent();
check(
  "PDF以外はエラー表示される",
  Boolean(alertText && alertText.includes("PDFファイルではありません")),
  (alertText ?? "").slice(0, 60),
);

const brokenPdf = path.join(OUT, "broken.pdf");
await fs.writeFile(brokenPdf, "%PDF-1.7\nthis file is truncated garbage");
await page.locator('input[type="file"]').first().setInputFiles(brokenPdf);
await page.waitForTimeout(2500);
const brokenAlert = await page.locator('[role="alert"]').first().textContent();
check(
  "壊れたPDFはエラー表示される",
  Boolean(brokenAlert && /PDF/.test(brokenAlert)),
  (brokenAlert ?? "").slice(0, 70),
);

// ---------------------------------------------------------------
// 8) ドラッグ&ドロップでの読み込み
// ---------------------------------------------------------------
console.log("\n[8] ドラッグ&ドロップ");
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
const dropBytes = await fs.readFile(path.join(FIXTURES, "single-page.pdf"));
await page.evaluate(async (base64) => {
  const raw = atob(base64);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) data[i] = raw.charCodeAt(i);
  const file = new File([data], "dropped.pdf", { type: "application/pdf" });
  const transfer = new DataTransfer();
  transfer.items.add(file);

  const zone = document.querySelector("h2")?.closest("div");
  for (const type of ["dragenter", "dragover", "drop"]) {
    zone.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }
}, dropBytes.toString("base64"));
await page.waitForSelector("svg[data-edit-layer]", { timeout: 30000 });
check("ドラッグ&ドロップでPDFを開ける", true);

// ---------------------------------------------------------------
// 9) 複数行テキスト / ページ回転 / ページ削除
// ---------------------------------------------------------------
console.log("\n[9] 複数行 / ページ回転 / ページ削除");
await openFixture("multi-page.pdf");

// 複数行テキスト
await page.getByRole("button", { name: "テキスト" }).click();
await page.locator("svg[data-edit-layer]").first().click({ position: { x: 80, y: 200 } });
await page.waitForSelector("textarea:focus");
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type("1行目のテキスト");
await page.keyboard.press("Enter");
await page.keyboard.type("2行目のテキスト");
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(250);
const tspanCount = await page.locator("svg[data-edit-layer] text tspan").count();
check("複数行テキストが行ごとに描画される", tspanCount === 2, `${tspanCount}行`);

// ページ回転
const sizeBefore = await page.locator("[data-pdf-page]").first().boundingBox();
await page.getByRole("button", { name: "90°回転" }).click();
await page.waitForTimeout(1200);
const sizeAfter = await page.locator("[data-pdf-page]").first().boundingBox();
check(
  "ページを90°回転できる",
  Math.abs(sizeAfter.width - sizeBefore.height) < 2 &&
    Math.abs(sizeAfter.height - sizeBefore.width) < 2,
  `${Math.round(sizeBefore.width)}x${Math.round(sizeBefore.height)} → ${Math.round(sizeAfter.width)}x${Math.round(sizeAfter.height)}`,
);

// ページ削除
await page.getByRole("button", { name: "2ページ目を削除" }).click();
await page.waitForTimeout(600);
const pageLabel = await page.locator("main").isVisible();
const remaining = await page.locator("[data-thumbnail-scroll] > div").count();
check("ページを削除できる", remaining === 2 && pageLabel, `残り${remaining}ページ`);

const afterDeleteExport = await exportAndSave("page-ops-edited.pdf");
await installHarness();
const afterDeleteResult = await measureExportedInk(afterDeleteExport.target, 0);
check(
  "ページ削除が出力PDFに反映される",
  afterDeleteResult.pageCount === 2,
  `${afterDeleteResult.pageCount}ページ`,
);
check(
  "回転ページの複数行テキストが出力される",
  afterDeleteResult.textItems.join("").includes("1行目のテキスト") &&
    afterDeleteResult.textItems.join("").includes("2行目のテキスト"),
  afterDeleteResult.textItems.join(" | ").slice(0, 80),
);

// ---------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------
// pdf.js を後から注入した影響でワーカー由来の警告が出ることがあるため、
// アプリ本体に関係しないものは除外する。
const relevantConsoleErrors = consoleErrors.filter(
  (message) => !/pdf\.min\.mjs|Failed to load resource/.test(message),
);
check("consoleエラーが出ていない", relevantConsoleErrors.length === 0, relevantConsoleErrors.slice(0, 3).join(" / "));
check("未捕捉の例外が出ていない", pageErrors.length === 0, pageErrors.slice(0, 3).join(" / "));

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? `, ${failed.length} FAILED` : ""),
);
process.exit(failed.length === 0 ? 0 : 1);
