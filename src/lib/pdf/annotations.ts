import { PDFHexString, PDFName, PDFString } from "pdf-lib";
import type {
  PDFDocument,
  PDFObject,
  PDFOperator,
  PDFPage,
  PDFRef,
} from "pdf-lib";
import { hexToRgb01 } from "./coordinates";
import { normalizedToPdf, penOutline } from "./drawElements";
import type { PageGeometry } from "./drawElements";
import type { EditorElement, Point } from "@/types/editor";

/**
 * 「焼き込み」ではなく本物の PDF 注釈として書き出す
 * ------------------------------------------------------------------
 * ページの内容ストリームへ直接描くと、あとから他のツールで動かしたり
 * 消したりできない。注釈オブジェクトとして書けば、Acrobat やプレビューで
 * 選択・編集・削除できる注釈になる。
 *
 * 見た目は外観ストリーム (/AP) として自前で持たせる。ビューアによっては
 * 外観を自動生成しない（そのまま何も描かれない）ため、ここを省略できない。
 * 外観の中身はページへ描くときとまったく同じオペレータ列なので、
 * どちらのモードでも見た目は一致する。
 */

/**
 * PDF の「文字列」を作る。
 *
 * `PDFContext.obj("...")` は素の文字列を **名前 (/Name)** として書き出すため、
 * /Contents や /T のような本文にそのまま渡すと読めないものになる。
 * 日本語も入るので UTF-16BE の16進文字列にする。
 */
function pdfText(value: string): PDFHexString {
  return PDFHexString.fromText(value);
}

/**
 * `PDFContext.obj()` が受け取れる値。pdf-lib は同等の型を公開していないので、
 * ここで構造だけ合わせて定義する。
 */
type PdfLiteral =
  | string
  | number
  | boolean
  | null
  | undefined
  | PDFObject
  | PdfLiteral[]
  | { [key: string]: PdfLiteral };

type PdfDictLiteral = { [key: string]: PdfLiteral };

/** 注釈の外観ストリームが使うリソースを集める器。 */
export class AnnotationResources {
  private extGStates = new Map<string, PDFRef>();
  private fonts = new Map<string, PDFRef>();
  private xObjects = new Map<string, PDFRef>();
  private counter = 0;

  constructor(private readonly doc: PDFDocument) {}

  addExtGState(dict: PdfDictLiteral): PDFName {
    const ref = this.doc.context.register(this.doc.context.obj(dict));
    const name = `GS${this.counter++}`;
    this.extGStates.set(name, ref);
    return PDFName.of(name);
  }

  addFont(ref: PDFRef): PDFName {
    for (const [name, existing] of this.fonts) {
      if (existing === ref) return PDFName.of(name);
    }
    const name = `F${this.counter++}`;
    this.fonts.set(name, ref);
    return PDFName.of(name);
  }

  addXObject(ref: PDFRef): PDFName {
    for (const [name, existing] of this.xObjects) {
      if (existing === ref) return PDFName.of(name);
    }
    const name = `X${this.counter++}`;
    this.xObjects.set(name, ref);
    return PDFName.of(name);
  }

  /** 集めたものを Resources 辞書にまとめる。 */
  build(): PdfDictLiteral {
    const entries: PdfDictLiteral = {};

    if (this.extGStates.size > 0) {
      entries.ExtGState = Object.fromEntries(this.extGStates);
    }
    if (this.fonts.size > 0) {
      entries.Font = Object.fromEntries(this.fonts);
    }
    if (this.xObjects.size > 0) {
      entries.XObject = Object.fromEntries(this.xObjects);
    }

    return entries;
  }
}

export interface AnnotationBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 外観ストリーム付きの注釈をページへ追加する。
 *
 * `operators` はページのユーザー空間で組み立て済みのもの。外観の
 * BBox を注釈の矩形と一致させ、変換行列を単位行列にすることで、
 * 座標をそのまま使える。
 */
export function appendAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  element: EditorElement,
  geo: PageGeometry,
  operators: PDFOperator[],
  box: AnnotationBox,
  resources: AnnotationResources,
): void {
  if (operators.length === 0) return;

  const appearanceRef = doc.context.register(
    doc.context.formXObject(operators, {
      FormType: 1,
      BBox: [box.x0, box.y0, box.x1, box.y1],
      Matrix: [1, 0, 0, 1, 0, 0],
      Resources: resources.build(),
    }),
  );

  const thread = element.comment;

  const base: PdfDictLiteral = {
    Type: "Annot",
    Rect: [box.x0, box.y0, box.x1, box.y1],
    // 4 = Print。印刷にも出るようにする。
    F: 4,
    AP: { N: appearanceRef },
    Border: [0, 0, 0],
    CA: element.opacity,
    // コメントが付いていれば、それを注釈の本文と作成者にする。
    T: pdfText(thread?.author ?? "PDF Editor"),
    M: PDFString.of(pdfDateString(thread ? new Date(thread.createdAt) : new Date())),
    ...(thread?.resolved ? { StateModel: "Review", State: "Completed" } : {}),
  };

  const specific = annotationSpecifics(element, geo);
  if (!specific) return;

  const merged: PdfDictLiteral = { ...base, ...specific };
  // コメントは種類ごとの既定文言より優先する。
  if (thread) merged.Contents = pdfText(thread.text);

  const dict = doc.context.obj(merged);
  const annotationRef = doc.context.register(dict);
  page.node.addAnnot(annotationRef);

  // 返信は、親を指す別の注釈として並べる。Acrobat などでスレッドに見える。
  for (const reply of thread?.replies ?? []) {
    const replyDict = doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      // 返信は本体の脇に小さく置く。
      Rect: [box.x1, box.y0, box.x1 + 18, box.y0 + 18],
      F: 4,
      Contents: pdfText(reply.text),
      T: pdfText(reply.author),
      M: PDFString.of(pdfDateString(new Date(reply.createdAt))),
      // /IRT = In Reply To、/RT /R = 返信であることの指定。
      IRT: annotationRef,
      RT: "R",
      Name: "Comment",
      Open: false,
    });
    page.node.addAnnot(doc.context.register(replyDict));
  }
}

/** 要素の種類ごとの注釈固有エントリ。 */
function annotationSpecifics(
  element: EditorElement,
  geo: PageGeometry,
): PdfDictLiteral | null {
  const toPdf = (point: Point) => normalizedToPdf(geo, point.x, point.y);

  switch (element.type) {
    case "highlight": {
      // QuadPoints は 左上・右上・左下・右下 の順に 8 個の数値。
      const corners = [
        toPdf({ x: element.x, y: element.y }),
        toPdf({ x: element.x + element.w, y: element.y }),
        toPdf({ x: element.x, y: element.y + element.h }),
        toPdf({ x: element.x + element.w, y: element.y + element.h }),
      ];
      return {
        Subtype: "Highlight",
        QuadPoints: corners.flatMap((point) => [point.x, point.y]),
        C: colorArray(element.color),
        Contents: pdfText("ハイライト"),
      };
    }

    case "rect":
      return {
        Subtype: "Square",
        C: element.stroke ? colorArray(element.stroke) : [],
        IC: element.fill ? colorArray(element.fill) : [],
        BS: { W: element.stroke ? element.strokeWidth : 0, S: "S" },
        Contents: pdfText("四角形"),
      };

    case "ellipse":
      return {
        Subtype: "Circle",
        C: element.stroke ? colorArray(element.stroke) : [],
        IC: element.fill ? colorArray(element.fill) : [],
        BS: { W: element.stroke ? element.strokeWidth : 0, S: "S" },
        Contents: pdfText("円"),
      };

    case "arrow": {
      const start = toPdf({ x: element.x1, y: element.y1 });
      const end = toPdf({ x: element.x2, y: element.y2 });
      return {
        Subtype: "Line",
        L: [start.x, start.y, end.x, end.y],
        LE: element.head ? ["None", "ClosedArrow"] : ["None", "None"],
        C: colorArray(element.color),
        IC: element.head ? colorArray(element.color) : [],
        BS: { W: element.strokeWidth, S: "S" },
        Contents: pdfText(element.head ? "矢印" : "直線"),
      };
    }

    case "pen": {
      const outline = element.pressure
        ? penOutline(element.points, element.strokeWidth, geo.view)
        : element.points;
      return {
        Subtype: "Ink",
        InkList: [outline.flatMap((point) => {
          const pdfPoint = toPdf(point);
          return [pdfPoint.x, pdfPoint.y];
        })],
        C: colorArray(element.color),
        BS: { W: element.strokeWidth, S: "S" },
        Contents: pdfText("フリーハンド"),
      };
    }

    case "text":
      return {
        Subtype: "FreeText",
        // DA は外観を自動生成する場合の書式指定。/AP を持たせているので
        // 実際には使われないが、仕様上必須なので置いておく。
        DA: PDFString.of(
          `${colorArray(element.color).join(" ")} rg /Helv ${element.fontSize} Tf`,
        ),
        Contents: pdfText(element.text),
        Q: element.align === "center" ? 1 : element.align === "right" ? 2 : 0,
      };

    case "image":
      return {
        Subtype: "Stamp",
        Name: "Draft",
        Contents: pdfText("画像"),
      };

    default:
      return null;
  }
}

function colorArray(hex: string): number[] {
  const { r, g, b } = hexToRgb01(hex);
  return [r, g, b];
}

/** PDF の日付文字列 (D:YYYYMMDDHHmmSS)。 */
function pdfDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
