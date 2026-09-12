// 開発用の動作確認スクリプト。実ブラウザでアプリを操作し、
// 「プレビューの見た目」と「書き出した PDF の見た目」を実ピクセルで突き合わせる。
//
//   node scripts/e2e-check.mjs <baseUrl> <fixtureDir> <outDir>
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:3111";
// GitHub Pages のように下の階層で配信されている場合に備え、資材の位置は
// アプリの URL から組み立てる（例: http://host/pdf_edit → /pdf_edit/pdfjs/）。
const ASSET_BASE = `${new URL(BASE_URL).pathname.replace(/\/$/, "")}/pdfjs/`;
const FIXTURES = process.argv[3] ?? "./fixtures";
const OUT = process.argv[4] ?? "./e2e-out";

const PDFJS_MAIN = "node_modules/pdfjs-dist/build/pdf.min.mjs";
/** 追加要素の色。元 PDF の黒い内容と区別するため赤にする。 */
const MARK_COLOR = "#dc2626";

await fs.mkdir(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
const pageErrors = [];

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(
    `${passed ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1600, height: 1000 },
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
  // ハイドレーション前に操作しても onChange が拾われないので、
  // 落ち着くまで待ってから、それでも駄目なら投入し直す。
  await page.waitForLoadState("networkidle").catch(() => {});

  // 前回の自動保存が残っていると復帰ダイアログが操作を邪魔する。
  const discard = page.getByRole("button", { name: "今は開かない" });
  if ((await discard.count()) > 0) {
    await discard.click();
    await page.waitForTimeout(200);
  }

  const input = page.locator('input[type="file"][accept*="pdf"]').first();
  for (let attempt = 0; ; attempt += 1) {
    await input.setInputFiles(path.join(FIXTURES, name));
    try {
      await page.waitForSelector("svg[data-edit-layer]", { timeout: 20000 });
      break;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
  // 2ページ目以降は画面に入るまで描画しない設計なので、先頭ページだけ待つ。
  await page.waitForFunction(
    () => !document.querySelector('[data-page-index="0"] .animate-spin'),
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(300);
}

const pickTool = (label) =>
  page.getByRole("button", { name: label, exact: true }).click();

/** インスペクタのボタンを押す。 */
const inspectorButton = (label) =>
  page.getByRole("button", { name: label, exact: true });

/** 右パネルのタブを切り替える。 */
const openPanel = (label) =>
  page.getByRole("tab", { name: label, exact: true }).click();

/** 右パネルの見出し（選択中の要素の種類など）。 */
const panelHeading = () =>
  page.locator("aside").last().locator("span").first().textContent();

/** ページ上の要素の数（描画・当たり判定・選択枠を除いた実数）。 */
const shapeCount = () =>
  page.evaluate(() =>
    document.querySelectorAll(
      "[data-page-index] svg[data-edit-layer] > text," +
        "[data-page-index] svg[data-edit-layer] > rect[fill]:not([fill='transparent'])," +
        "[data-page-index] svg[data-edit-layer] > ellipse," +
        "[data-page-index] svg[data-edit-layer] > path[stroke]," +
        "[data-page-index] svg[data-edit-layer] > polygon," +
        "[data-page-index] svg[data-edit-layer] > image," +
        "[data-page-index] svg[data-edit-layer] > g",
    ).length,
  );

/** 指定ページの編集レイヤー。 */
const layer = (pageIndex = 0) =>
  page.locator(`[data-page-index="${pageIndex}"] svg[data-edit-layer]`);

/** ページ上の相対位置 (0〜1) をブラウザ座標へ直す。 */
async function pointOn(pageIndex, nx, ny) {
  // 連続スクロール表示なので、対象ページを画面へ入れてから座標を取る。
  await layer(pageIndex).scrollIntoViewIfNeeded();
  await page.waitForFunction(
    (index) =>
      !document.querySelector(`[data-page-index="${index}"] .animate-spin`),
    pageIndex,
    { timeout: 30000 },
  );
  await page.waitForTimeout(150);
  const box = await layer(pageIndex).boundingBox();
  return { x: box.x + box.width * nx, y: box.y + box.height * ny };
}

/** ページ上をドラッグして図形を描く。 */
async function drawOn(pageIndex, from, to, steps = 12) {
  const start = await pointOn(pageIndex, from[0], from[1]);
  const end = await pointOn(pageIndex, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** テキストツールでページ上をクリックし、文字を入力して確定する。 */
async function addText(text, pageIndex, nx, ny) {
  await pickTool("テキスト");
  const point = await pointOn(pageIndex, nx, ny);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector("textarea:focus", { timeout: 5000 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.waitForTimeout(250);
}

/** @font-face のフォントが実際に使える状態になるまで待つ。 */
async function waitForFont() {
  await page.waitForFunction(
    () =>
      Array.from(document.fonts).some(
        (face) =>
          face.family.includes("NotoSansJPEmbedded") && face.status === "loaded",
      ),
    undefined,
    { timeout: 60000 },
  );
}

/** 計測用に、ページ全体がビューポートへ収まる倍率にする。 */
async function fitPageForMeasurement() {
  await page.getByLabel("表示倍率").selectOption("fit-page");
  await page.waitForTimeout(600);
}

async function setProperty(label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.blur();
  await page.waitForTimeout(120);
}

/**
 * 追加要素が実際に描かれている領域を、ページ矩形に対する比率で返す。
 *
 * 計測前に選択を解除する。選択枠とリサイズハンドルは要素の輪郭や端点の
 * 真上に描かれるため、選択したままだと図形のインクを隠してしまう。
 */
async function measurePreviewInk(pageIndex = 0) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // 画面下部の通知はページの上に重なるため、出たままだと計測を汚す。
  // 出ていたら内容を控えて閉じる（エラーなら検査項目として記録する）。
  await dismissBanner();

  const box = await layer(pageIndex).boundingBox();
  const viewport = page.viewportSize();
  if (
    box.y < 0 ||
    box.y + box.height > viewport.height ||
    box.x + box.width > viewport.width
  ) {
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

/** 書き出した PDF を pdf.js で描画し、赤い領域と文字を取り出す。 */
async function measureExportedInk(pdfPath, pageIndex = 0) {
  const bytes = await fs.readFile(pdfPath);
  return page.evaluate(
    async ({ base64, pageIndex }) => {
      const raw = atob(base64);
      const data = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) data[i] = raw.charCodeAt(i);

      const doc = await globalThis.pdfjsLib.getDocument({
        data,
        cMapUrl: `${globalThis.__assetBase}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${globalThis.__assetBase}standard_fonts/`,
        wasmUrl: `${globalThis.__assetBase}wasm/`,
        iccUrl: `${globalThis.__assetBase}iccs/`,
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

      const text = await pdfPage.getTextContent();
      const annotations = await pdfPage.getAnnotations();
      return {
        ink: globalThis.__findRedInk(ctx, canvas.width, canvas.height),
        nonWhite: globalThis.__countNonWhite(ctx, canvas.width, canvas.height),
        pageCount: doc.numPages,
        textItems: text.items.map((item) => item.str),
        annotations: annotations.map((a) => a.subtype),
      };
    },
    { base64: bytes.toString("base64"), pageIndex },
  );
}

async function installHarness() {
  await page.addScriptTag({ path: PDFJS_MAIN, type: "module" });
  await page.waitForFunction(() => Boolean(globalThis.pdfjsLib), undefined, {
    timeout: 15000,
  });
  await page.evaluate((assetBase) => {
    globalThis.__assetBase = assetBase;
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = `${assetBase}pdf.worker.min.mjs`;

    // 探す色。既定は赤、ハイライトのときは黄色に切り替える。
    globalThis.__inkTarget = "red";
    globalThis.__isInk = (r, g, b) =>
      globalThis.__inkTarget === "yellow"
        // 既定の不透明度 45% だと白と混ざってかなり淡い黄色になる。
        ? r > 200 && g > 190 && b < 215 && r - b > 45
        : r > 140 && g < 110 && b < 110;

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
          if (globalThis.__isInk(data[i], data[i + 1], data[i + 2])) {
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

    globalThis.__countNonWhite = (ctx, width, height) => {
      const { data } = ctx.getImageData(0, 0, width, height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) count += 1;
      }
      return count;
    };
  }, ASSET_BASE);
}

/** 画面下部の通知を閉じる。エラーが出ていたら検査項目として記録する。 */
async function dismissBanner() {
  const close = page.getByRole("button", { name: "通知を閉じる" });
  if ((await close.count()) === 0) return;

  const text = (await page.locator('[role="alert"]').allTextContents()).join(" ");
  if (text.trim().length > 0) {
    check("計測中にエラー通知が出ていない", false, text.slice(0, 80));
  }
  await close.first().click();
  await page.waitForTimeout(150);
}

/** インク検出の対象色を切り替える。 */
async function setInkTarget(target) {
  await page.evaluate((value) => {
    globalThis.__inkTarget = value;
  }, target);
}

/** レンジ入力（線の太さなど）へ値を入れる。 */
async function setRange(label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.evaluate((node, next) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    setter.call(node, String(next));
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, value);
  await page.waitForTimeout(150);
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

const elementCount = () =>
  page.evaluate(
    () =>
      document.querySelectorAll("[data-page-index] svg[data-edit-layer] > *")
        .length,
  );

// ---------------------------------------------------------------
// 1) 基本: 読み込み / 日本語入力 / 位置の一致
// ---------------------------------------------------------------
console.log("\n[1] 1ページPDF / 日本語テキスト / 位置の一致");
await openFixture("single-page.pdf");
check("1ページPDFを読み込める", true);

await addText("こんにちは研究計画書", 0, 0.2, 0.25);
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).click();
await setProperty("フォントサイズ（数値）", 32);
await setProperty("X", 20);
await setProperty("Y", 30);
await waitForFont();
await fitPageForMeasurement();

await installHarness();
const textPreview = await measurePreviewInk();
check("プレビューに追加テキストが描画されている", textPreview !== null);

const textExport = await exportAndSave("text.pdf");
check(
  "出力ファイル名が <元名>-edited.pdf になる",
  textExport.suggested === "single-page-edited.pdf",
  textExport.suggested,
);

const textResult = await measureExportedInk(textExport.target);
check(
  "元PDFの内容が維持されている",
  textResult.textItems.join("").includes("Single Page Fixture"),
);
check(
  "出力PDFで日本語が文字化けしない",
  textResult.textItems.join("").includes("こんにちは研究計画書"),
  textResult.textItems.join(" | ").slice(0, 90),
);

if (textPreview && textResult.ink) {
  const dx = Math.abs(textPreview.x0 - textResult.ink.x0);
  const dy = Math.abs(textPreview.y0 - textResult.ink.y0);
  const dw = Math.abs(
    textPreview.x1 - textPreview.x0 - (textResult.ink.x1 - textResult.ink.x0),
  );
  check(
    "テキストのプレビューと出力位置が一致する",
    dx < 0.006 && dy < 0.006 && dw < 0.006,
    `dx=${(dx * 100).toFixed(2)}% dy=${(dy * 100).toFixed(2)}% dW=${(dw * 100).toFixed(2)}%`,
  );
}

// ---------------------------------------------------------------
// 2) 図形ツール: 描画 → 位置の一致 → 書き出し
// ---------------------------------------------------------------
const SHAPES = [
  { tool: "四角形", name: "rect", from: [0.2, 0.2], to: [0.6, 0.4] },
  { tool: "円", name: "ellipse", from: [0.2, 0.2], to: [0.6, 0.45] },
  { tool: "矢印", name: "arrow", from: [0.2, 0.25], to: [0.7, 0.5] },
  { tool: "フリーハンド", name: "pen", from: [0.2, 0.3], to: [0.7, 0.55] },
  { tool: "ハイライト", name: "highlight", from: [0.15, 0.2], to: [0.7, 0.26] },
];

for (const shape of SHAPES) {
  console.log(`\n[2] ${shape.tool}`);
  await openFixture("single-page.pdf");
  await pickTool(shape.tool);
  await drawOn(0, shape.from, shape.to, shape.name === "pen" ? 25 : 12);

  const created = await elementCount();
  check(`${shape.tool}を描画できる`, created > 0, `要素 ${created}`);

  // 色を赤に統一して、元PDFの黒い内容と区別できるようにする。
  // ハイライトは黄色系しか選べないので、そのまま黄色で比べる。
  const colorButton = page.getByRole("button", {
    name: `色を ${MARK_COLOR} にする`,
  });
  if ((await colorButton.count()) > 0) await colorButton.first().click();

  // 細い線は縮小表示でアンチエイリアスに埋もれ、端の画素を拾えなくなる。
  // 計測を安定させるため太くしておく。
  if (shape.name === "arrow" || shape.name === "pen") {
    await setRange("線の太さ", 8);
  }
  await page.waitForTimeout(200);

  await fitPageForMeasurement();
  await installHarness();
  await setInkTarget(shape.name === "highlight" ? "yellow" : "red");
  const preview = await measurePreviewInk();
  const exported = await exportAndSave(`${shape.name}.pdf`);
  await setInkTarget(shape.name === "highlight" ? "yellow" : "red");
  const result = await measureExportedInk(exported.target);

  check(`${shape.tool}が出力PDFに含まれる`, result.ink !== null);

  if (preview && result.ink) {
    const dx = Math.abs(preview.x0 - result.ink.x0);
    const dy = Math.abs(preview.y0 - result.ink.y0);
    const dw = Math.abs(
      preview.x1 - preview.x0 - (result.ink.x1 - result.ink.x0),
    );
    const dh = Math.abs(
      preview.y1 - preview.y0 - (result.ink.y1 - result.ink.y0),
    );
    check(
      `${shape.tool}のプレビューと出力位置が一致する`,
      dx < 0.01 && dy < 0.01 && dw < 0.012 && dh < 0.012,
      `dx=${(dx * 100).toFixed(2)}% dy=${(dy * 100).toFixed(2)}% dW=${(dw * 100).toFixed(2)}% dH=${(dh * 100).toFixed(2)}%`,
    );
  } else {
    check(`${shape.tool}のプレビューと出力位置が一致する`, false, "ink未検出");
  }
}

// ---------------------------------------------------------------
// 3) ハイライトが下の文字を消していないこと
// ---------------------------------------------------------------
console.log("\n[3] ハイライトの重ね方");
await openFixture("japanese.pdf");
await pickTool("ハイライト");
await drawOn(0, [0.08, 0.08], [0.6, 0.13]);
const highlightExport = await exportAndSave("highlight-over-text.pdf");
await installHarness();
const highlightResult = await measureExportedInk(highlightExport.target);
check(
  "ハイライトの下の文字が読める（乗算合成）",
  highlightResult.textItems.join("").includes("研究計画書"),
  highlightResult.textItems.join(" | ").slice(0, 60),
);

// ---------------------------------------------------------------
// 4) 画像の挿入
// ---------------------------------------------------------------
console.log("\n[4] 画像");
await openFixture("single-page.pdf");
await pickTool("画像");
const imagePoint = await pointOn(0, 0.2, 0.3);
await Promise.all([
  page.waitForEvent("filechooser").then((chooser) =>
    chooser.setFiles(path.join(FIXTURES, "..", "logo.png")),
  ),
  page.mouse.click(imagePoint.x, imagePoint.y),
]);
await page.waitForTimeout(800);
const imageCount = await page.locator("[data-page-index] svg image").count();
check("画像を貼り付けられる", imageCount === 1, `image要素 ${imageCount}`);

const imageExport = await exportAndSave("image.pdf");
await installHarness();
const imageResult = await measureExportedInk(imageExport.target);
check(
  "画像が出力PDFに焼き込まれる",
  imageResult.nonWhite > 20000,
  `非白ピクセル ${imageResult.nonWhite}`,
);

// ---------------------------------------------------------------
// 5) 直接操作: 移動 / リサイズ / 複数選択 / 複製 / 微調整
// ---------------------------------------------------------------
console.log("\n[5] 直接操作");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.2, 0.2], [0.5, 0.35]);

const readRect = () =>
  page.evaluate(() => {
    const node = document.querySelector(
      "[data-page-index] svg[data-edit-layer] rect",
    );
    return node
      ? {
          x: Number(node.getAttribute("x")),
          y: Number(node.getAttribute("y")),
          w: Number(node.getAttribute("width")),
          h: Number(node.getAttribute("height")),
        }
      : null;
  });

const rectBefore = await readRect();

// 移動
await pickTool("選択");
const grab = await pointOn(0, 0.35, 0.27);
const drop = await pointOn(0, 0.55, 0.47);
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
await page.mouse.move(drop.x, drop.y, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(250);
const rectMoved = await readRect();
check(
  "図形をドラッグ移動できる",
  Math.abs(rectMoved.x - rectBefore.x) > 5 &&
    Math.abs(rectMoved.y - rectBefore.y) > 5,
  `x ${rectBefore.x.toFixed(0)} → ${rectMoved.x.toFixed(0)}`,
);

// リサイズ（右下ハンドル）
const handles = page.locator("[data-page-index] svg[data-edit-layer] rect");
const handleCount = await handles.count();
check("選択するとリサイズハンドルが出る", handleCount >= 9, `${handleCount} 個の矩形`);

const seHandle = await page.evaluate(() => {
  const nodes = [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] rect"),
  ].filter((node) => node.style.cursor === "nwse-resize");
  const node = nodes.at(-1);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});
if (seHandle) {
  await page.mouse.move(seHandle.x, seHandle.y);
  await page.mouse.down();
  await page.mouse.move(seHandle.x + 120, seHandle.y + 80, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const rectResized = await readRect();
  check(
    "ハンドルでリサイズできる",
    rectResized.w > rectMoved.w + 50 && rectResized.h > rectMoved.h + 30,
    `${rectMoved.w.toFixed(0)}x${rectMoved.h.toFixed(0)} → ${rectResized.w.toFixed(0)}x${rectResized.h.toFixed(0)}`,
  );
} else {
  check("ハンドルでリサイズできる", false, "ハンドルが見つからない");
}

// 矢印キーでの微調整（複製する前に、対象がひとつだけの状態で確かめる）
const beforeNudge = await readRect();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(250);
const afterNudge = await readRect();
check(
  "矢印キーで微調整できる",
  afterNudge.x > beforeNudge.x,
  `x ${beforeNudge.x.toFixed(1)} → ${afterNudge.x.toFixed(1)}`,
);

// 複製
await page.keyboard.press("ControlOrMeta+d");
await page.waitForTimeout(250);
const afterDuplicate = await elementCount();
check("Cmd/Ctrl+D で複製できる", afterDuplicate >= 2, `要素 ${afterDuplicate}`);

// 範囲選択（マーキー）
await pickTool("選択");
const marqueeFrom = await pointOn(0, 0.02, 0.02);
const marqueeTo = await pointOn(0, 0.98, 0.95);
await page.mouse.move(marqueeFrom.x, marqueeFrom.y);
await page.mouse.down();
await page.mouse.move(marqueeTo.x, marqueeTo.y, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(250);
const inspectorTitle = await panelHeading();
check(
  "ドラッグで範囲選択できる",
  Boolean(inspectorTitle && inspectorTitle.includes("選択中")),
  inspectorTitle ?? "",
);

// まとめて削除
await page.keyboard.press("Delete");
await page.waitForTimeout(250);
check("まとめて削除できる", (await elementCount()) === 0);

// Undo / Redo
await page.keyboard.press("ControlOrMeta+z");
await page.waitForTimeout(250);
check("Undoで復活する", (await elementCount()) > 0);
await page.keyboard.press("ControlOrMeta+Shift+z");
await page.waitForTimeout(250);
check("Redoで再び消える", (await elementCount()) === 0);

// ---------------------------------------------------------------
// 6) 連続スクロールとページ操作
// ---------------------------------------------------------------
console.log("\n[6] 連続スクロール / ページ操作");
await openFixture("multi-page.pdf");
const renderedPages = await page.locator("[data-pdf-page]").count();
check("全ページが縦に並ぶ", renderedPages === 3, `${renderedPages}ページ`);

await addText("2ページ目のテキスト", 1, 0.2, 0.2);
await page.waitForTimeout(300);

// ページ送りで表示位置が変わる
const headerPageNumber = async () => {
  const text = await page
    .locator("header span.tabular-nums")
    .first()
    .textContent();
  return (text ?? "").replace(/\s+/g, " ").trim();
};

await page.getByRole("button", { name: "1ページ目を表示" }).click();
await page.waitForTimeout(900);
const firstPageLabel = await headerPageNumber();
await page.getByRole("button", { name: "次のページ" }).click();
await page.waitForTimeout(900);
const secondPageLabel = await headerPageNumber();
check(
  "ページ送りでスクロールする",
  firstPageLabel.startsWith("1") && secondPageLabel.startsWith("2"),
  `${firstPageLabel} → ${secondPageLabel}`,
);

// ページ複製: [P1, P2, P3] → [P1, P1', P2, P3]
await page.getByRole("button", { name: "1ページ目を複製" }).click();
await page.waitForTimeout(900);
check(
  "ページを複製できる",
  (await page.locator("[data-pdf-page]").count()) === 4,
);

// ページ並べ替え: 4ページ目 (P3) を 3番目へ上げる → [P1, P1', P3, P2]
await page.getByRole("button", { name: "4ページ目を上へ" }).click();
await page.waitForTimeout(700);

const pageOpsExport = await exportAndSave("page-ops.pdf");
await installHarness();
const pageOpsResult = await measureExportedInk(pageOpsExport.target, 0);
check(
  "ページ操作が出力PDFに反映される",
  pageOpsResult.pageCount === 4,
  `${pageOpsResult.pageCount}ページ`,
);

const allText = [];
for (let index = 0; index < pageOpsResult.pageCount; index += 1) {
  const result = await measureExportedInk(pageOpsExport.target, index);
  allText.push(result.textItems.join(""));
}
check(
  "追加テキストがページ操作後も残る",
  allText.join("").includes("2ページ目のテキスト"),
);
check(
  "並べ替えが出力順に反映される",
  allText[0].includes("Page 1") &&
    allText[1].includes("Page 1") &&
    allText[2].includes("Page 3") &&
    allText[3].includes("Page 2"),
  allText.map((text) => text.slice(0, 14)).join(" / "),
);
check(
  "並べ替えても要素は同じページに付いてくる",
  allText[3].includes("2ページ目のテキスト"),
  allText[3].slice(0, 30),
);

// ---------------------------------------------------------------
// 7) 回転ページ / CropBox オフセット
// ---------------------------------------------------------------
for (const [fixture, label] of [
  ["rotated.pdf", "回転ページ"],
  ["offset-cropbox.pdf", "CropBoxオフセット"],
]) {
  console.log(`\n[7] ${label}`);
  await openFixture(fixture);
  await pickTool("四角形");
  await drawOn(0, [0.25, 0.3], [0.6, 0.5]);
  await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).first().click();
  await page.waitForTimeout(200);
  await fitPageForMeasurement();

  await installHarness();
  const preview = await measurePreviewInk();
  const exported = await exportAndSave(`${fixture.replace(".pdf", "")}.pdf`);
  const result = await measureExportedInk(exported.target, 0);

  if (preview && result.ink) {
    const dx = Math.abs(preview.x0 - result.ink.x0);
    const dy = Math.abs(preview.y0 - result.ink.y0);
    check(
      `${label}でも位置が一致する`,
      dx < 0.012 && dy < 0.012,
      `dx=${(dx * 100).toFixed(2)}% dy=${(dy * 100).toFixed(2)}%`,
    );
  } else {
    check(`${label}でも位置が一致する`, false, "ink未検出");
  }
}

// ---------------------------------------------------------------
// 8) IME入力
// ---------------------------------------------------------------
console.log("\n[8] IME入力");
await openFixture("single-page.pdf");
await pickTool("テキスト");
const imePoint = await pointOn(0, 0.2, 0.2);
await page.mouse.click(imePoint.x, imePoint.y);
await page.waitForSelector("textarea:focus");
await page.evaluate(() => {
  const textarea = document.activeElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  ).set;
  textarea.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  setter.call(textarea, "にほんご");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  setter.call(textarea, "日本語入力");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(
    new CompositionEvent("compositionend", {
      bubbles: true,
      data: "日本語入力",
    }),
  );
});
await page.waitForTimeout(200);
await page.keyboard.press("ControlOrMeta+Enter");
await page.waitForTimeout(300);
const imeText = await page.evaluate(
  () =>
    document.querySelector("[data-page-index] svg[data-edit-layer] text")
      ?.textContent ?? null,
);
check("IME変換確定の日本語が反映される", imeText === "日本語入力", String(imeText));

// ---------------------------------------------------------------
// 9) ドラッグ&ドロップ / エラーハンドリング
// ---------------------------------------------------------------
console.log("\n[9] 読み込みとエラー");
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
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
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }
}, dropBytes.toString("base64"));
await page.waitForSelector("svg[data-edit-layer]", { timeout: 30000 });
check("ドラッグ&ドロップでPDFを開ける", true);

await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
const notPdf = path.join(OUT, "not-a-pdf.txt");
await fs.writeFile(notPdf, "this is not a pdf");
await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(notPdf);
await page.waitForTimeout(500);
const alertText = await page.locator('[role="alert"]').first().textContent();
check(
  "PDF以外はエラー表示される",
  Boolean(alertText && alertText.includes("PDFファイルではありません")),
  (alertText ?? "").slice(0, 50),
);

const brokenPdf = path.join(OUT, "broken.pdf");
await fs.writeFile(brokenPdf, "%PDF-1.7\nthis file is truncated garbage");
await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(brokenPdf);
await page.waitForTimeout(2500);
const brokenAlert = await page.locator('[role="alert"]').first().textContent();
check(
  "壊れたPDFはエラー表示される",
  Boolean(brokenAlert && /PDF/.test(brokenAlert)),
  (brokenAlert ?? "").slice(0, 60),
);


// ---------------------------------------------------------------
// 10) スタイルの引き継ぎ / 重なり順
// ---------------------------------------------------------------
console.log("\n[10] スタイルの引き継ぎ / 重なり順");
await openFixture("single-page.pdf");

await pickTool("四角形");
await drawOn(0, [0.15, 0.15], [0.45, 0.3]);
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).first().click();
await page.waitForTimeout(250);

// 2つ目の四角形が、直前に選んだ色で始まるか
await pickTool("四角形");
await drawOn(0, [0.5, 0.15], [0.8, 0.3]);
await page.waitForTimeout(250);
const secondStroke = await page.evaluate(() => {
  const rects = [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect"),
  ].filter((node) => node.getAttribute("fill") === "none");
  return rects.at(-1)?.getAttribute("stroke") ?? null;
});
check(
  "最後に使った色が次の要素へ引き継がれる",
  secondStroke === MARK_COLOR,
  String(secondStroke),
);

// 重なり順
const orderBefore = await page.evaluate(() =>
  [...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect")]
    .filter((n) => n.getAttribute("fill") === "none")
    .map((n) => n.getAttribute("x")),
);
await inspectorButton("最背面へ").click();
await page.waitForTimeout(250);
const orderAfter = await page.evaluate(() =>
  [...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect")]
    .filter((n) => n.getAttribute("fill") === "none")
    .map((n) => n.getAttribute("x")),
);
check(
  "重なり順を変更できる",
  orderBefore.join() !== orderAfter.join(),
  `${orderBefore.join()} → ${orderAfter.join()}`,
);

// ---------------------------------------------------------------
// 11) 要素の回転
// ---------------------------------------------------------------
console.log("\n[11] 要素の回転");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.2, 0.2], [0.6, 0.35]);
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).first().click();
await setRange("回転", 30);
await page.waitForTimeout(300);

const rotationApplied = await page.evaluate(() => {
  const g = [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > g"),
  ].find((node) => (node.getAttribute("transform") ?? "").startsWith("rotate("));
  return g?.getAttribute("transform") ?? null;
});
check(
  "プレビューで要素が回転する",
  Boolean(rotationApplied && rotationApplied.includes("rotate(30")),
  String(rotationApplied),
);

await fitPageForMeasurement();
await installHarness();
await setInkTarget("red");
const rotPreview = await measurePreviewInk();
const rotExport = await exportAndSave("rotated-element.pdf");
await setInkTarget("red");
const rotResult = await measureExportedInk(rotExport.target);
if (rotPreview && rotResult.ink) {
  const dx = Math.abs(rotPreview.x0 - rotResult.ink.x0);
  const dy = Math.abs(rotPreview.y0 - rotResult.ink.y0);
  const dw = Math.abs(
    rotPreview.x1 - rotPreview.x0 - (rotResult.ink.x1 - rotResult.ink.x0),
  );
  check(
    "回転した要素の位置が出力と一致する",
    dx < 0.012 && dy < 0.012 && dw < 0.015,
    `dx=${(dx * 100).toFixed(2)}% dy=${(dy * 100).toFixed(2)}% dW=${(dw * 100).toFixed(2)}%`,
  );
} else {
  check("回転した要素の位置が出力と一致する", false, "ink未検出");
}

// ---------------------------------------------------------------
// 12) 太字 / 斜体 / 折り返し
// ---------------------------------------------------------------
console.log("\n[12] 太字 / 斜体 / 折り返し");
await openFixture("single-page.pdf");
await addText("日本語のテキストです", 0, 0.15, 0.2);

await inspectorButton("太字").click();
await page.waitForTimeout(400);
const boldFamily = await page.evaluate(
  () =>
    document
      .querySelector("[data-page-index] svg[data-edit-layer] > text")
      ?.getAttribute("font-family") ?? null,
);
check(
  "太字にするとBoldフォントに切り替わる",
  boldFamily === "NotoSansJPEmbeddedBold",
  String(boldFamily),
);

await inspectorButton("斜体").click();
await page.waitForTimeout(250);
// 疑似イタリックは文字ごとの <tspan> に skewX として付く。
const italicApplied = await page.evaluate(
  () =>
    document
      .querySelector("[data-page-index] svg[data-edit-layer] > text tspan")
      ?.getAttribute("transform") ?? null,
);
check(
  "斜体を適用できる",
  Boolean(italicApplied && italicApplied.includes("skew")),
  String(italicApplied),
);

// 折り返し（禁則処理つき）
await inspectorButton("斜体").click();
await inspectorButton("太字").click();
await page.locator("#prop-text").fill("これは折り返しの確認用の、長い日本語の文章です。句読点が行頭に来ないことも確かめます。");
await page.locator("#prop-text").blur();
await page.waitForTimeout(300);
await inspectorButton("折り返しを有効にする").click();
await page.waitForTimeout(400);

// 文字は 1 つずつ <tspan> で置かれているので、ベースライン (y) が同じものを
// まとめ直して「行」を復元する。
const wrapped = await page.evaluate(() => {
  const byBaseline = new Map();
  for (const node of document.querySelectorAll(
    "[data-page-index] svg[data-edit-layer] > text tspan",
  )) {
    const key = Number(node.getAttribute("y")).toFixed(2);
    byBaseline.set(key, (byBaseline.get(key) ?? "") + (node.textContent ?? ""));
  }
  return [...byBaseline.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, text]) => text);
});
check("テキストが自動で折り返される", wrapped.length > 1, `${wrapped.length}行`);
check(
  "行頭に句読点が来ない（禁則処理）",
  wrapped.length > 1 &&
    wrapped.slice(1).every((line) => !"、。".includes(line[0] ?? "")),
  wrapped.join(" / "),
);

await waitForFont();
const wrapExport = await exportAndSave("wrapped.pdf");
await installHarness();
const wrapResult = await measureExportedInk(wrapExport.target);
check(
  "折り返した文章が出力PDFにも入る",
  wrapResult.textItems.join("").includes("句読点が行頭に来ない"),
  wrapResult.textItems.join("").slice(0, 40),
);

// ---------------------------------------------------------------
// 13) 整列 / グループ / ロック
// ---------------------------------------------------------------
console.log("\n[13] 整列 / グループ / ロック");
await openFixture("single-page.pdf");
for (const [i, spec] of [
  [0.1, 0.15, 0.3, 0.25],
  [0.4, 0.3, 0.6, 0.42],
  [0.7, 0.5, 0.9, 0.6],
].entries()) {
  await pickTool("四角形");
  await drawOn(0, [spec[0], spec[1]], [spec[2], spec[3]]);
  void i;
}
await pickTool("選択");
await page.keyboard.press("ControlOrMeta+a");
await page.waitForTimeout(250);

await inspectorButton("上揃え").click();
await page.waitForTimeout(300);
const tops = await page.evaluate(() =>
  [...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect")]
    .filter((n) => n.getAttribute("fill") === "none")
    .map((n) => Number(n.getAttribute("y"))),
);
check(
  "上揃えできる",
  tops.length >= 3 && Math.max(...tops) - Math.min(...tops) < 1,
  tops.map((t) => t.toFixed(1)).join(", "),
);

await inspectorButton("左右に等間隔").click();
await page.waitForTimeout(300);
const gaps = await page.evaluate(() => {
  const rects = [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect"),
  ]
    .filter((n) => n.getAttribute("fill") === "none")
    .map((n) => ({
      x: Number(n.getAttribute("x")),
      w: Number(n.getAttribute("width")),
    }))
    .sort((a, b) => a.x - b.x);
  return rects.slice(1).map((r, i) => r.x - (rects[i].x + rects[i].w));
});
check(
  "等間隔に配置できる",
  gaps.length >= 2 && Math.abs(gaps[0] - gaps[1]) < 1,
  gaps.map((g) => g.toFixed(1)).join(", "),
);

// グループ化
await page.keyboard.press("ControlOrMeta+g");
await page.waitForTimeout(250);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const groupPoint = await pointOn(0, 0.2, 0.2);
await page.mouse.click(groupPoint.x, groupPoint.y);
await page.waitForTimeout(250);
const groupSelectionLabel = await panelHeading();
check(
  "グループはまとめて選択される",
  Boolean(groupSelectionLabel && groupSelectionLabel.includes("3 個")),
  String(groupSelectionLabel),
);

// ロック
await inspectorButton("ロック").click();
await page.waitForTimeout(250);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
await page.mouse.click(groupPoint.x, groupPoint.y);
await page.waitForTimeout(250);
const afterLockLabel = await panelHeading();
check(
  "ロックした要素は選択できない",
  afterLockLabel === "プロパティ",
  String(afterLockLabel),
);

// ---------------------------------------------------------------
// 14) スナップ
// ---------------------------------------------------------------
console.log("\n[14] スナップ");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.2, 0.2], [0.5, 0.3]);
await pickTool("四角形");
await drawOn(0, [0.2, 0.5], [0.5, 0.6]);
await pickTool("選択");

// 2つ目を1つ目の左端付近まで動かすと吸着するはず
const grabPoint = await pointOn(0, 0.35, 0.55);
const nearAlign = await pointOn(0, 0.353, 0.7);
await page.mouse.move(grabPoint.x, grabPoint.y);
await page.mouse.down();
await page.mouse.move(nearAlign.x, nearAlign.y, { steps: 10 });
await page.waitForTimeout(200);
const guideVisible = await page.evaluate(
  () =>
    document.querySelectorAll(
      "[data-page-index] svg[data-edit-layer] line[stroke='#ec4899']",
    ).length,
);
await page.mouse.up();
await page.waitForTimeout(250);

const xs = await page.evaluate(() =>
  [...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect")]
    .filter((n) => n.getAttribute("fill") === "none")
    .map((n) => Number(n.getAttribute("x"))),
);
check("スナップの目安線が出る", guideVisible > 0, `${guideVisible}本`);
check(
  "他の要素の端に吸着する",
  xs.length >= 2 && Math.abs(xs[0] - xs[1]) < 0.5,
  xs.map((x) => x.toFixed(2)).join(", "),
);

// ---------------------------------------------------------------
// 15) 既存テキストの選択と書き換え / ハイライトの行吸着
// ---------------------------------------------------------------
console.log("\n[15] 既存テキストの扱い");
await openFixture("japanese.pdf");

// ハイライトが文字の行に吸着するか
// わざと文字より縦に大きい範囲をなぞり、行の高さへ縮むかを見る。
await pickTool("ハイライト");
await drawOn(0, [0.05, 0.06], [0.55, 0.16]);
await page.waitForTimeout(1200);
const snapped = await page.evaluate(() =>
  [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect"),
  ]
    .filter((n) => n.style.mixBlendMode === "multiply")
    .map((n) => ({
      y: Number(n.getAttribute("y")),
      h: Number(n.getAttribute("height")),
      w: Number(n.getAttribute("width")),
    })),
);
const drawnHeight = 0.1 * 841.89; // なぞった範囲の高さ (ポイント)
check(
  "ハイライトが文字の行の高さに吸着する",
  snapped.length >= 1 && snapped[0].h < drawnHeight * 0.7,
  snapped.map((s) => `h=${s.h.toFixed(0)}`).join(", ") + ` (なぞった高さ ${drawnHeight.toFixed(0)})`,
);

// 既存テキストの書き換え
await openFixture("japanese.pdf");
await pickTool("既存テキストを編集");
await drawOn(0, [0.08, 0.075], [0.5, 0.115]);
await page.waitForTimeout(1200);

const editorOpen = await page.locator("textarea:focus").count();
const extracted = await page.evaluate(
  () => document.querySelector("textarea")?.value ?? "",
);
check(
  "既存テキストをなぞると内容が取り込まれる",
  editorOpen > 0 && extracted.includes("研究計画書"),
  extracted.slice(0, 20),
);

await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type("事業計画書");
await page.keyboard.press("ControlOrMeta+Enter");
await page.waitForTimeout(400);
await waitForFont();

const rewriteExport = await exportAndSave("text-rewrite.pdf");
await installHarness();
const rewriteResult = await measureExportedInk(rewriteExport.target);
check(
  "書き換えた文字が出力に入る",
  rewriteResult.textItems.join("").includes("事業計画書"),
  rewriteResult.textItems.join("").slice(0, 40),
);

// ---------------------------------------------------------------
// 16) 検索
// ---------------------------------------------------------------
console.log("\n[16] 検索");
await openFixture("japanese.pdf");
await page.keyboard.press("ControlOrMeta+f");
await page.waitForTimeout(300);
await page.getByRole("textbox", { name: "文書内を検索" }).fill("システム");
await page.waitForTimeout(1500);
const searchHits = await page.evaluate(
  () =>
    document.querySelectorAll(
      "[data-page-index] svg[data-edit-layer] rect[fill='#facc15']",
    ).length,
);
check("検索でヒット箇所が光る", searchHits > 0, `${searchHits}箇所`);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ---------------------------------------------------------------
// 17) PDF注釈として書き出す
// ---------------------------------------------------------------
console.log("\n[17] PDF注釈モード");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.2, 0.2], [0.6, 0.4]);
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).first().click();
await page.waitForTimeout(250);
await page.getByLabel("書き出し方").selectOption("annotate");
await page.waitForTimeout(200);

await fitPageForMeasurement();
await installHarness();
await setInkTarget("red");
const annotPreview = await measurePreviewInk();
const annotExport = await exportAndSave("annotated.pdf");
await setInkTarget("red");
const annotResult = await measureExportedInk(annotExport.target);

check(
  "PDF注釈オブジェクトとして書き出される",
  annotResult.annotations.includes("Square"),
  annotResult.annotations.join(", ") || "注釈なし",
);
check("注釈にも外観が付いていて描画される", annotResult.ink !== null);
if (annotPreview && annotResult.ink) {
  const dx = Math.abs(annotPreview.x0 - annotResult.ink.x0);
  const dy = Math.abs(annotPreview.y0 - annotResult.ink.y0);
  check(
    "注釈モードでも位置が一致する",
    dx < 0.012 && dy < 0.012,
    `dx=${(dx * 100).toFixed(2)}% dy=${(dy * 100).toFixed(2)}%`,
  );
}

// ---------------------------------------------------------------
// 18) PDF結合 / ページ抽出
// ---------------------------------------------------------------
console.log("\n[18] 結合 / 抽出");
await openFixture("single-page.pdf");
await page
  .locator('input[aria-label="結合するPDF"]')
  .setInputFiles(path.join(FIXTURES, "multi-page.pdf"));
await page.waitForTimeout(2000);
const mergedPages = await page.locator("[data-pdf-page]").count();
check("別のPDFを結合できる", mergedPages === 4, `${mergedPages}ページ`);

const mergedExport = await exportAndSave("merged.pdf");
await installHarness();
const mergedResult = await measureExportedInk(mergedExport.target, 0);
check(
  "結合結果が出力PDFに反映される",
  mergedResult.pageCount === 4,
  `${mergedResult.pageCount}ページ`,
);
const mergedTexts = [];
for (let i = 0; i < mergedResult.pageCount; i += 1) {
  mergedTexts.push((await measureExportedInk(mergedExport.target, i)).textItems.join(""));
}
check(
  "結合後もそれぞれの内容が残る",
  mergedTexts[0].includes("Single Page Fixture") && mergedTexts[1].includes("Page 1"),
  mergedTexts.map((t) => t.slice(0, 12)).join(" / "),
);

// ページ抽出（インスペクタの「このページを抽出」を使う）
await page.getByRole("button", { name: "3ページ目を表示" }).click();
await page.waitForTimeout(900);
const [extractDownload] = await Promise.all([
  page.waitForEvent("download", { timeout: 60000 }),
  page.getByRole("button", { name: "ページ抽出" }).click(),
]);
const extractExport = { target: path.join(OUT, "extracted.pdf") };
await extractDownload.saveAs(extractExport.target);
await installHarness();
const extractResult = await measureExportedInk(extractExport.target, 0);
check(
  "選択中のページだけを抽出できる",
  extractResult.pageCount === 1,
  `${extractResult.pageCount}ページ`,
);

// ---------------------------------------------------------------
// 19) スタンプ
// ---------------------------------------------------------------
console.log("\n[19] スタンプ");
await openFixture("single-page.pdf");
await pickTool("フリーハンド");
await drawOn(0, [0.2, 0.2], [0.5, 0.35], 25);
await pickTool("選択");
await page.waitForTimeout(200);
await inspectorButton("スタンプとして保存").click();
await page.waitForTimeout(300);
await page.getByLabel("スタンプの名前").fill("テスト署名");
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.waitForTimeout(400);

const beforePlace = await shapeCount();
await page.getByRole("button", { name: "テスト署名 を配置" }).click();
await page.waitForTimeout(400);
const afterPlace = await shapeCount();
check(
  "保存したスタンプを配置できる",
  afterPlace > beforePlace,
  `${beforePlace} → ${afterPlace}`,
);

// ---------------------------------------------------------------
// 20) 自動保存と復帰
// ---------------------------------------------------------------
console.log("\n[20] 自動保存と復帰");
await openFixture("single-page.pdf");
await addText("保存テスト用テキスト", 0, 0.2, 0.2);
await page.waitForTimeout(2500);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1200);
const restoreVisible = await page
  .getByRole("button", { name: "続きから再開" })
  .count();
check("再読み込み後に復帰を促される", restoreVisible > 0);

if (restoreVisible > 0) {
  await page.getByRole("button", { name: "続きから再開" }).click();
  await page.waitForSelector("svg[data-edit-layer]", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const restoredText = await page.evaluate(
    () =>
      document.querySelector("[data-page-index] svg[data-edit-layer] > text")
        ?.textContent ?? null,
  );
  check(
    "編集内容が復元される",
    restoredText === "保存テスト用テキスト",
    String(restoredText),
  );
}

// ---------------------------------------------------------------
// 21) ペン入力（筆圧・手のひら誤爆よけ）
// ---------------------------------------------------------------
console.log("\n[21] ペン入力");
await openFixture("single-page.pdf");
await pickTool("フリーハンド");
await page.evaluate(async () => {
  const svg = document.querySelector('[data-page-index="0"] svg[data-edit-layer]');
  const box = svg.getBoundingClientRect();
  const send = (type, nx, ny, pressure, pointerType) =>
    svg.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType,
        pressure,
        button: 0,
        buttons: 1,
        clientX: box.x + box.width * nx,
        clientY: box.y + box.height * ny,
      }),
    );

  send("pointerdown", 0.2, 0.3, 0.2, "pen");
  for (let i = 1; i <= 20; i += 1) {
    send("pointermove", 0.2 + i * 0.02, 0.3 + Math.sin(i / 3) * 0.05, i / 20, "pen");
  }
  send("pointerup", 0.6, 0.3, 0.9, "pen");
});
await page.waitForTimeout(400);

const pressureShape = await page.evaluate(
  () =>
    document.querySelectorAll("[data-page-index] svg[data-edit-layer] > polygon")
      .length,
);
check(
  "ペン入力は筆圧に応じた太さで描かれる",
  pressureShape > 0,
  `polygon ${pressureShape}`,
);

// 手のひら（タッチ）は無視される
const beforePalm = await shapeCount();
await page.evaluate(async () => {
  const svg = document.querySelector('[data-page-index="0"] svg[data-edit-layer]');
  const box = svg.getBoundingClientRect();
  const send = (type, nx, ny) =>
    svg.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 2,
        pointerType: "touch",
        pressure: 0.5,
        button: 0,
        buttons: 1,
        clientX: box.x + box.width * nx,
        clientY: box.y + box.height * ny,
      }),
    );
  send("pointerdown", 0.2, 0.7);
  send("pointermove", 0.5, 0.8);
  send("pointerup", 0.5, 0.8);
});
await page.waitForTimeout(300);
check(
  "ペン使用後は手のひら（タッチ）を無視する",
  (await shapeCount()) === beforePalm,
);


// ---------------------------------------------------------------
// 22) パスワード保護PDF
// ---------------------------------------------------------------
console.log("\n[22] パスワード保護PDF");
let hasEncryptedFixture = true;
try {
  await fs.access(path.join(FIXTURES, "encrypted.pdf"));
} catch {
  hasEncryptedFixture = false;
  check("保護されたPDFでパスワード入力が出る", false, "fixture がありません");
}

if (hasEncryptedFixture) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  // 前回の自動保存が残っていると復帰ダイアログが邪魔をする。
  const discard = page.getByRole("button", { name: "今は開かない" });
  if ((await discard.count()) > 0) await discard.click();

  await page
    .locator('input[type="file"][accept*="pdf"]')
    .first()
    .setInputFiles(path.join(FIXTURES, "encrypted.pdf"));
  await page.waitForTimeout(2000);

  const promptShown = await page.getByLabel("パスワード").count();
  check("保護されたPDFでパスワード入力が出る", promptShown > 0);

  if (promptShown > 0) {
    // まず間違ったパスワードを入れる
    await page.getByLabel("パスワード").fill("wrong");
    await page.getByRole("dialog").getByRole("button", { name: "開く" }).click();
    await page.waitForTimeout(1500);
    const wrongMessage = await page.locator('[role="alert"]').allTextContents();
    check(
      "間違ったパスワードだと知らせてくれる",
      wrongMessage.join("").includes("パスワードが違います"),
      wrongMessage.join("").slice(0, 40),
    );

    await page.getByLabel("パスワード").fill("secret");
    await page.getByRole("dialog").getByRole("button", { name: "開く" }).click();
    await page.waitForSelector("svg[data-edit-layer]", { timeout: 30000 });
    await page.waitForFunction(
      () => !document.querySelector('[data-page-index="0"] .animate-spin'),
      undefined,
      { timeout: 30000 },
    );
    check("正しいパスワードで開ける", true);

    // 開いたあとは普通に編集・書き出しできる
    await addText("保護PDFへの追記", 0, 0.2, 0.3);
    await waitForFont();
    const protectedExport = await exportAndSave("from-protected.pdf");
    await installHarness();
    const protectedResult = await measureExportedInk(protectedExport.target);
    check(
      "保護PDFにも編集して書き出せる",
      protectedResult.textItems.join("").includes("保護PDFへの追記"),
      protectedResult.textItems.join("").slice(0, 40),
    );
  }
}


// ---------------------------------------------------------------
// 23) 縦書き / 文字詰め / ぶら下げ
// ---------------------------------------------------------------
console.log("\n[23] 日本語組版");
await openFixture("single-page.pdf");
await addText("こんにちは、世界。「引用」もある。", 0, 0.2, 0.15);

// 文字詰め: 句読点の後ろが半角ぶん詰まっているか
const spacing = await page.evaluate(() => {
  const tspans = [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > text tspan"),
  ].map((n) => ({ char: n.textContent, x: Number(n.getAttribute("x")) }));
  const commaIndex = tspans.findIndex((t) => t.char === "、");
  if (commaIndex < 1 || commaIndex + 1 >= tspans.length) return null;
  return {
    beforeComma: tspans[commaIndex].x - tspans[commaIndex - 1].x,
    afterComma: tspans[commaIndex + 1].x - tspans[commaIndex].x,
  };
});
check(
  "句読点の後ろが詰まる（文字詰め）",
  Boolean(spacing && spacing.afterComma < spacing.beforeComma * 0.7),
  spacing ? `前=${spacing.beforeComma.toFixed(1)} 後=${spacing.afterComma.toFixed(1)}` : "計測不可",
);

// 縦書き
await inspectorButton("縦書き").click();
await page.waitForTimeout(400);
const verticalLayout = await page.evaluate(() => {
  const tspans = [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > text tspan"),
  ].map((n) => ({
    char: n.textContent,
    x: Number(n.getAttribute("x")),
    y: Number(n.getAttribute("y")),
    rotated: (n.getAttribute("transform") ?? "").includes("rotate"),
  }));
  return {
    count: tspans.length,
    // 縦書きなら Y が増えていき、X はほぼ動かない
    yIncreasing: tspans.length > 2 && tspans[1].y > tspans[0].y,
    xStable: tspans.length > 2 && Math.abs(tspans[1].x - tspans[0].x) < 1,
    hasRotated: tspans.some((t) => t.rotated),
  };
});
check(
  "縦書きで文字が縦に積まれる",
  verticalLayout.yIncreasing && verticalLayout.xStable,
  JSON.stringify(verticalLayout),
);
check(
  "縦書きで括弧などが回転する",
  verticalLayout.hasRotated,
  `回転あり=${verticalLayout.hasRotated}`,
);

await waitForFont();
const verticalExport = await exportAndSave("vertical.pdf");
await installHarness();
const verticalResult = await measureExportedInk(verticalExport.target);
check(
  "縦書きが出力PDFにも入る",
  verticalResult.textItems.join("").includes("こんにちは"),
  verticalResult.textItems.join("").slice(0, 30),
);

// ---------------------------------------------------------------
// 24) 吹き出し
// ---------------------------------------------------------------
console.log("\n[24] 吹き出し");
await openFixture("single-page.pdf");
await pickTool("吹き出し");
await drawOn(0, [0.35, 0.3], [0.75, 0.45]);
await page.waitForTimeout(400);

const calloutParts = await page.evaluate(() => {
  const g = document.querySelector("[data-page-index] svg[data-edit-layer] > g");
  return {
    hasLine: Boolean(g?.querySelector("line")),
    hasBox: Boolean(g?.querySelector("rect")),
    hasText: Boolean(g?.querySelector("text")),
  };
});
check(
  "吹き出しは枠・引き出し線・文字で構成される",
  calloutParts.hasLine && calloutParts.hasBox && calloutParts.hasText,
  JSON.stringify(calloutParts),
);

// 指し先ハンドルで線の向きを変えられる
const targetHandle = await page.evaluate(() => {
  const nodes = [
    ...document.querySelectorAll("[data-page-index] svg[data-edit-layer] rect"),
  ].filter((n) => n.style.cursor === "move");
  const node = nodes.at(-1);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});
if (targetHandle) {
  const lineBefore = await page.evaluate(() => {
    const l = document.querySelector("[data-page-index] svg[data-edit-layer] line");
    return l ? Number(l.getAttribute("x2")) : null;
  });
  await page.mouse.move(targetHandle.x, targetHandle.y);
  await page.mouse.down();
  await page.mouse.move(targetHandle.x + 120, targetHandle.y + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const lineAfter = await page.evaluate(() => {
    const l = document.querySelector("[data-page-index] svg[data-edit-layer] line");
    return l ? Number(l.getAttribute("x2")) : null;
  });
  check(
    "吹き出しの指し先を動かせる",
    lineBefore !== null && lineAfter !== null && Math.abs(lineAfter - lineBefore) > 20,
    `x2: ${lineBefore?.toFixed(0)} → ${lineAfter?.toFixed(0)}`,
  );
} else {
  check("吹き出しの指し先を動かせる", false, "ハンドルが見つからない");
}

await waitForFont();
const calloutExport = await exportAndSave("callout.pdf");
await installHarness();
const calloutResult = await measureExportedInk(calloutExport.target);
check(
  "吹き出しが出力PDFに入る",
  calloutResult.textItems.join("").includes("テキストを入力"),
  calloutResult.textItems.join("").slice(0, 30),
);

// ---------------------------------------------------------------
// 25) レイヤーパネル
// ---------------------------------------------------------------
console.log("\n[25] レイヤーパネル");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.15, 0.15], [0.4, 0.3]);
await pickTool("円");
await drawOn(0, [0.5, 0.15], [0.75, 0.3]);
await openPanel("レイヤー");
await page.waitForTimeout(300);

const layerRows = await page.locator("aside li").count();
check("レイヤー一覧に要素が並ぶ", layerRows >= 2, `${layerRows}件`);

// 表示の切り替え
await page.getByRole("button", { name: "隠す", exact: true }).first().click();
await page.waitForTimeout(300);
const visibleShapes = await page.evaluate(
  () =>
    document.querySelectorAll(
      "[data-page-index] svg[data-edit-layer] > ellipse, [data-page-index] svg[data-edit-layer] > rect[fill='none']",
    ).length,
);
check("レイヤーから要素を隠せる", visibleShapes < 2, `表示中 ${visibleShapes}`);

await page.getByRole("button", { name: "表示する", exact: true }).first().click();
await page.waitForTimeout(300);
check(
  "隠した要素を戻せる",
  (await page.evaluate(
    () =>
      document.querySelectorAll(
        "[data-page-index] svg[data-edit-layer] > ellipse, [data-page-index] svg[data-edit-layer] > rect[fill='none']",
      ).length,
  )) >= 2,
);

// ---------------------------------------------------------------
// 26) コメントと返信
// ---------------------------------------------------------------
console.log("\n[26] コメント");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.2, 0.2], [0.5, 0.35]);
await openPanel("コメント");
await page.waitForTimeout(300);

await page.getByLabel("あなたの名前").fill("レビュー担当");
await page.getByLabel("コメント本文").fill("ここの表現を直してください");
await page.getByRole("button", { name: "コメントを追加" }).click();
await page.waitForTimeout(400);

const commentText = await page.locator("aside li").first().textContent();
check(
  "コメントを追加できる",
  Boolean(commentText && commentText.includes("ここの表現を直して")),
  (commentText ?? "").slice(0, 40),
);

await page.getByLabel("返信").fill("修正しました");
await page.getByRole("button", { name: "送信" }).click();
await page.waitForTimeout(400);
const withReply = await page.locator("aside li").first().textContent();
check(
  "返信を追加できる",
  Boolean(withReply && withReply.includes("修正しました")),
);

// 注釈モードで書き出すとコメントが /Contents に入る
await page.getByLabel("書き出し方").selectOption("annotate");
await page.waitForTimeout(200);
const commentExport = await exportAndSave("commented.pdf");
await installHarness();
const commentResult = await page.evaluate(async (base64) => {
  const raw = atob(base64);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) data[i] = raw.charCodeAt(i);
  const doc = await globalThis.pdfjsLib.getDocument({ data }).promise;
  const p = await doc.getPage(1);
  const annots = await p.getAnnotations();
  return annots.map((a) => ({ subtype: a.subtype, contents: a.contentsObj?.str ?? a.contents ?? "" }));
}, (await fs.readFile(commentExport.target)).toString("base64"));
check(
  "コメントが注釈として書き出される",
  commentResult.some((a) => String(a.contents).includes("ここの表現")),
  JSON.stringify(commentResult).slice(0, 100),
);

// ---------------------------------------------------------------
// 27) 単位表示 / 最近使った色
// ---------------------------------------------------------------
console.log("\n[27] 単位と色の記憶");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.25, 0.25], [0.5, 0.4]);
await openPanel("プロパティ");
await page.waitForTimeout(300);

const percentValue = await page.getByLabel("X", { exact: true }).inputValue();
await page.getByLabel("単位").selectOption("mm");
await page.waitForTimeout(300);
const mmValue = await page.getByLabel("X", { exact: true }).inputValue();
check(
  "単位を mm に切り替えられる",
  Number(mmValue) > Number(percentValue) * 1.5,
  `${percentValue}% → ${mmValue}mm`,
);

// mm で入れた値が反映される
await page.getByLabel("X", { exact: true }).fill("50");
await page.getByLabel("X", { exact: true }).blur();
await page.waitForTimeout(300);
const movedX = await page.evaluate(() => {
  const r = [...document.querySelectorAll("[data-page-index] svg[data-edit-layer] > rect")]
    .find((n) => n.getAttribute("fill") === "none");
  return r ? Number(r.getAttribute("x")) : null;
});
// 50mm ≒ 141.7pt
check(
  "mm で位置を指定できる",
  movedX !== null && Math.abs(movedX - 141.7) < 3,
  `x=${movedX?.toFixed(1)}pt (期待 141.7)`,
);

// 最近使った色
await page.getByLabel("単位").selectOption("percent");
await page.getByRole("button", { name: `色を ${MARK_COLOR} にする` }).first().click();
await page.waitForTimeout(300);
const recentCount = await page.getByRole("button", { name: /最近使った色/ }).count();
check("使った色が「最近の色」に残る", recentCount > 0, `${recentCount}件`);

// ---------------------------------------------------------------
// 28) 白紙ページ / 用紙サイズ
// ---------------------------------------------------------------
console.log("\n[28] 白紙ページ / 用紙サイズ");
await openFixture("single-page.pdf");
await openPanel("プロパティ");
await page.getByRole("button", { name: "白紙を挿入" }).click();
await page.waitForTimeout(700);
check(
  "白紙ページを挿入できる",
  (await page.locator("[data-pdf-page]").count()) === 2,
);

const blankExport = await exportAndSave("with-blank.pdf");
await installHarness();
const blankResult = await measureExportedInk(blankExport.target, 1);
check(
  "白紙ページが出力に入る",
  blankResult.pageCount === 2 && blankResult.textItems.join("").length === 0,
  `${blankResult.pageCount}ページ`,
);

// 用紙サイズの変更
await page.getByRole("button", { name: "1ページ目を表示" }).click();
await page.waitForTimeout(500);
await page.getByLabel("用紙サイズ").selectOption({ label: "A3 縦" });
await page.waitForTimeout(500);
const resizedExport = await exportAndSave("resized.pdf");
await installHarness();
const resizedSize = await page.evaluate(async (base64) => {
  const raw = atob(base64);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) data[i] = raw.charCodeAt(i);
  const doc = await globalThis.pdfjsLib.getDocument({ data }).promise;
  const p = await doc.getPage(1);
  return p.view;
}, (await fs.readFile(resizedExport.target)).toString("base64"));
check(
  "用紙サイズを変更できる",
  Math.abs(resizedSize[2] - 841.89) < 2 && Math.abs(resizedSize[3] - 1190.55) < 2,
  `${resizedSize[2].toFixed(0)}x${resizedSize[3].toFixed(0)} (A3縦=842x1191)`,
);

// ---------------------------------------------------------------
// 29) キーボードだけの操作
// ---------------------------------------------------------------
console.log("\n[29] キーボード操作");
await openFixture("single-page.pdf");
await pickTool("四角形");
await drawOn(0, [0.15, 0.15], [0.35, 0.28]);
await pickTool("円");
await drawOn(0, [0.5, 0.15], [0.7, 0.28]);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

await page.keyboard.press("Tab");
await page.waitForTimeout(250);
const firstTab = await panelHeading();
await page.keyboard.press("Tab");
await page.waitForTimeout(250);
const secondTab = await panelHeading();
check(
  "Tab で要素を順に選べる",
  firstTab !== "プロパティ" && secondTab !== "プロパティ" && firstTab !== secondTab,
  `${firstTab} → ${secondTab}`,
);

await addText("キーボード編集", 0, 0.2, 0.5);
await page.keyboard.press("Escape");
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
// テキストが選ばれるまで Tab を送る
for (let i = 0; i < 4; i += 1) {
  if ((await panelHeading()) === "テキスト") break;
  await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
}
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check(
  "Enter でテキスト編集に入れる",
  (await page.locator("textarea:focus").count()) > 0,
);
await page.keyboard.press("Escape");

// ---------------------------------------------------------------
// 30) 印刷
// ---------------------------------------------------------------
console.log("\n[30] 印刷");
await openFixture("single-page.pdf");
// 印刷ダイアログ自体は自動操作できないので、印刷用の PDF が
// iframe として用意されるところまでを確かめる。
await page.getByRole("button", { name: "印刷", exact: true }).click();
await page.waitForTimeout(6000);
const printFrames = await page.evaluate(
  () => document.querySelectorAll('iframe[src^="blob:"]').length,
);
check("印刷用のPDFが用意される", printFrames > 0, `iframe ${printFrames}`);

// ---------------------------------------------------------------
// 31) 電子署名
// ---------------------------------------------------------------
console.log("\n[31] 電子署名");
await openFixture("single-page.pdf");
await page.getByRole("button", { name: "電子署名" }).click();
await page.waitForTimeout(300);
await page.getByLabel("署名者名").fill("署名テスト");

const [signedDownload] = await Promise.all([
  page.waitForEvent("download", { timeout: 120000 }),
  page.getByRole("button", { name: "署名して書き出す" }).click(),
]);
const signedPath = path.join(OUT, "signed.pdf");
await signedDownload.saveAs(signedPath);
check(
  "署名つきPDFを書き出せる",
  signedDownload.suggestedFilename().includes("signed"),
  signedDownload.suggestedFilename(),
);

// ByteRange と署名値の整合を確かめる
const signedBytes = await fs.readFile(signedPath);
const signedText = signedBytes.toString("latin1");
const rangeMatch = signedText.match(/\/ByteRange \[([^\]]+)\]/);
const contentsStart = signedText.indexOf("/Contents <") + "/Contents <".length;
const contentsEnd = signedText.indexOf(">", contentsStart);
check(
  "署名の ByteRange が正しい",
  Boolean(rangeMatch) &&
    (() => {
      const [a, b, c, d] = rangeMatch[1].trim().split(/\s+/).map(Number);
      return (
        a === 0 &&
        b === contentsStart - 1 &&
        c === contentsEnd + 1 &&
        b + d + (c - b) === signedBytes.length
      );
    })(),
  rangeMatch ? rangeMatch[1].trim() : "見つからない",
);

// 署名後も普通に開けるか
await installHarness();
const signedResult = await measureExportedInk(signedPath);
check(
  "署名後のPDFが開ける",
  signedResult.textItems.join("").includes("Single Page Fixture"),
  signedResult.textItems.join("").slice(0, 30),
);
check(
  "署名欄が注釈として入っている",
  signedResult.annotations.includes("Widget"),
  signedResult.annotations.join(", ") || "なし",
);

// ---------------------------------------------------------------
// 32) 最近の文書 / 複数文書の保持
// ---------------------------------------------------------------
console.log("\n[32] 最近の文書");
await openFixture("single-page.pdf");
await addText("文書A", 0, 0.2, 0.2);
await page.waitForTimeout(2500);

await openFixture("multi-page.pdf");
await addText("文書B", 0, 0.2, 0.2);
await page.waitForTimeout(2500);

const recentToggle = page.getByText("最近の文書", { exact: true });
check("最近の文書メニューが出る", (await recentToggle.count()) > 0);
if ((await recentToggle.count()) > 0) {
  await recentToggle.click();
  await page.waitForTimeout(300);
  const entries = await page.getByRole("button", { name: /single-page/ }).count();
  check("前に開いた文書が一覧に残る", entries > 0, `${entries}件`);
}

// ---------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------
const relevantConsoleErrors = consoleErrors.filter(
  (message) => !/pdf\.min\.mjs|Failed to load resource/.test(message),
);
check(
  "consoleエラーが出ていない",
  relevantConsoleErrors.length === 0,
  relevantConsoleErrors.slice(0, 3).join(" / "),
);
check(
  "未捕捉の例外が出ていない",
  pageErrors.length === 0,
  pageErrors.slice(0, 3).join(" / "),
);

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? `, ${failed.length} FAILED` : ""),
);
process.exit(failed.length === 0 ? 0 : 1);
