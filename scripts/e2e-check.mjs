// 開発用の動作確認スクリプト。実ブラウザでアプリを操作し、
// 「プレビューの見た目」と「書き出した PDF の見た目」を実ピクセルで突き合わせる。
//
//   node scripts/e2e-check.mjs <baseUrl> <fixtureDir> <outDir>
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:3111";
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

const pickTool = (label) => page.getByRole("button", { name: label, exact: true }).click();

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

      const text = await pdfPage.getTextContent();
      return {
        ink: globalThis.__findRedInk(ctx, canvas.width, canvas.height),
        nonWhite: globalThis.__countNonWhite(ctx, canvas.width, canvas.height),
        pageCount: doc.numPages,
        textItems: text.items.map((item) => item.str),
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
  await page.evaluate(() => {
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "/pdfjs/pdf.worker.min.mjs";

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
  });
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
await setProperty("X (%)", 20);
await setProperty("Y (%)", 30);
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
const inspectorTitle = await page
  .locator("aside")
  .last()
  .locator("span")
  .first()
  .textContent();
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
