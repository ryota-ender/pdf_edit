import { PDFDocument } from "pdf-lib";
import type { PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField } from "pdf-lib";
import { PdfEditorError } from "./errors";
import { createFontkitAdapter, loadFontkit, loadJapaneseFont } from "./font";

/**
 * フォーム（AcroForm）の記入
 * ------------------------------------------------------------------
 * 申請書などの入力欄を持つ PDF は、注釈を重ねるのではなく本来の
 * フォーム欄へ書き込んだほうが自然に仕上がる。
 *
 * 値は編集内容と一緒に保存し、書き出し時にまとめて流し込む。
 * 日本語を入れるので、書き込みの前に日本語フォントを差し替える。
 */

export type FormFieldKind = "text" | "checkbox" | "radio" | "dropdown";

export interface FormField {
  name: string;
  kind: FormFieldKind;
  /** 現在の値。チェックボックスは "on" / "" で表す。 */
  value: string;
  /** ラジオ・ドロップダウンの選択肢。 */
  options?: string[];
  readOnly: boolean;
  /** 欄が置かれているページ（0 始まり）。見つからなければ -1。 */
  pageIndex: number;
}

/** 読み込んだ PDF からフォーム欄の一覧を取り出す。 */
export async function readFormFields(bytes: Uint8Array): Promise<FormField[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes.slice());
  } catch {
    // 暗号化などで開けない場合はフォーム機能を出さない。
    return [];
  }

  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }
  if (fields.length === 0) return [];

  const pages = doc.getPages();
  const pageRefs = pages.map((page) => page.ref.toString());

  return fields.map((field): FormField => {
    const name = field.getName();

    // 欄がどのページにあるかは、ウィジェット注釈の /P から辿る。
    let pageIndex = -1;
    try {
      const widget = field.acroField.getWidgets()[0];
      const parent = widget?.P();
      if (parent) pageIndex = pageRefs.indexOf(parent.toString());
    } catch {
      pageIndex = -1;
    }

    const readOnly = (() => {
      try {
        return field.isReadOnly();
      } catch {
        return false;
      }
    })();

    const constructor = field.constructor.name;

    if (constructor === "PDFTextField") {
      const text = field as PDFTextField;
      return {
        name,
        kind: "text",
        value: text.getText() ?? "",
        readOnly,
        pageIndex,
      };
    }
    if (constructor === "PDFCheckBox") {
      const box = field as PDFCheckBox;
      return {
        name,
        kind: "checkbox",
        value: box.isChecked() ? "on" : "",
        readOnly,
        pageIndex,
      };
    }
    if (constructor === "PDFRadioGroup") {
      const radio = field as PDFRadioGroup;
      return {
        name,
        kind: "radio",
        value: radio.getSelected() ?? "",
        options: radio.getOptions(),
        readOnly,
        pageIndex,
      };
    }
    if (constructor === "PDFDropdown") {
      const dropdown = field as PDFDropdown;
      return {
        name,
        kind: "dropdown",
        value: dropdown.getSelected()[0] ?? "",
        options: dropdown.getOptions(),
        readOnly,
        pageIndex,
      };
    }

    return { name, kind: "text", value: "", readOnly: true, pageIndex };
  });
}

/**
 * 書き出す文書へフォームの値を書き込む。
 *
 * 日本語を入れると標準フォントでは化けるので、埋め込んだ日本語フォントで
 * 外観を作り直す。`flatten` を指定すると、編集できない普通の内容にする。
 */
export async function applyFormValues(
  pdfDoc: PDFDocument,
  values: Record<string, string>,
  options: { flatten: boolean },
): Promise<void> {
  const names = Object.keys(values);
  if (names.length === 0) return;

  let form;
  try {
    form = pdfDoc.getForm();
  } catch {
    return;
  }

  // 日本語の外観を作るためのフォント。
  let japanese;
  try {
    const fontkit = createFontkitAdapter(await loadFontkit());
    pdfDoc.registerFontkit(
      fontkit as Parameters<typeof pdfDoc.registerFontkit>[0],
    );
    const loaded = await loadJapaneseFont("regular");
    japanese = await pdfDoc.embedFont(loaded.cloneBytes(), { subset: true });
  } catch (error) {
    throw new PdfEditorError(
      "フォームへの書き込みに使うフォントを用意できませんでした。",
      { cause: error },
    );
  }

  for (const name of names) {
    const value = values[name];
    try {
      const field = form.getFieldMaybe(name);
      if (!field) continue;

      const constructor = field.constructor.name;
      if (constructor === "PDFTextField") {
        (field as PDFTextField).setText(value);
      } else if (constructor === "PDFCheckBox") {
        if (value) (field as PDFCheckBox).check();
        else (field as PDFCheckBox).uncheck();
      } else if (constructor === "PDFRadioGroup") {
        if (value) (field as PDFRadioGroup).select(value);
      } else if (constructor === "PDFDropdown") {
        if (value) (field as PDFDropdown).select(value);
      }
    } catch {
      // 1 つの欄が書けなくても、他の欄と本文の書き出しは続ける。
    }
  }

  try {
    // 外観を日本語フォントで作り直す。これをしないと文字化けする。
    form.updateFieldAppearances(japanese);
    if (options.flatten) form.flatten();
  } catch {
    // 外観の再生成に失敗しても、値そのものは書き込まれている。
  }
}
