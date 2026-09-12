import { PDFArray, PDFDict, PDFName, PDFNumber } from "pdf-lib";
import type { PDFDocument, PDFObject, PDFRef } from "pdf-lib";
import { isBlankPage } from "@/types/editor";
import type { PageState } from "@/types/editor";

/**
 * しおり（アウトライン）の引き継ぎ
 * ------------------------------------------------------------------
 * ページを並べ替え・結合・削除すると、pdf-lib の `copyPages` では
 * しおりが失われる。ここでは元の木構造をたどり直し、行き先のページ参照を
 * 並べ替え後の位置へ張り替えながら作り直す。
 *
 * 行き先が削除されたページの項目は落とす。子だけが残る場合は、
 * 親を「行き先なしの見出し」として残して階層を保つ。
 */

/** 元ページ番号 → 新しいページ番号の対応表を作る。 */
function buildPageMapping(
  states: PageState[],
  sourceId: string,
): Map<number, number> {
  const mapping = new Map<number, number>();
  states.forEach((state, index) => {
    if (state.sourceId !== sourceId || isBlankPage(state)) return;
    // 同じページが複製されている場合は最初の 1 つを行き先にする。
    if (!mapping.has(state.sourceIndex)) mapping.set(state.sourceIndex, index);
  });
  return mapping;
}

/** しおり項目の行き先ページ（元ファイル内のページ番号）を読む。 */
function destinationPageIndex(
  from: PDFDocument,
  item: PDFDict,
): number | null {
  const pageRefs = from.getPages().map((page) => page.ref.toString());

  const readArray = (value: unknown): number | null => {
    if (!(value instanceof PDFArray) || value.size() === 0) return null;
    const target = value.get(0);
    const index = pageRefs.indexOf(target.toString());
    return index >= 0 ? index : null;
  };

  // /Dest が直接入っている場合。
  const direct = item.get(PDFName.of("Dest"));
  if (direct) {
    const resolved = direct instanceof PDFArray ? direct : from.context.lookup(direct);
    const index = readArray(resolved);
    if (index !== null) return index;
  }

  // /A << /S /GoTo /D [...] >> の場合。
  const action = item.lookupMaybe(PDFName.of("A"), PDFDict);
  if (action) {
    const d = action.get(PDFName.of("D"));
    const resolved = d instanceof PDFArray ? d : d ? from.context.lookup(d) : null;
    const index = readArray(resolved);
    if (index !== null) return index;
  }

  return null;
}

/** `PDFContext.obj()` が受け取れる値。pdf-lib は同等の型を公開していない。 */
type PdfLiteral =
  | string
  | number
  | boolean
  | null
  | undefined
  | PDFObject
  | PdfLiteral[]
  | { [key: string]: PdfLiteral };

interface CopiedItem {
  ref: PDFRef;
  dict: PDFDict;
}

/**
 * しおりを新しい文書へ作り直す。
 * 引き継げるものが 1 つも無ければ何もしない。
 */
export function copyOutlines(
  from: PDFDocument,
  to: PDFDocument,
  states: PageState[],
  sourceId: string,
): void {
  try {
    const root = from.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
    if (!root) return;

    const mapping = buildPageMapping(states, sourceId);
    if (mapping.size === 0) return;

    const targetPages = to.getPages();

    /** 1 項目を作り直す。子が 1 つも残らず行き先も無ければ null。 */
    const copyItem = (item: PDFDict, parent: PDFRef): CopiedItem | null => {
      const children = copySiblings(item.lookupMaybe(PDFName.of("First"), PDFDict));

      const sourceIndex = destinationPageIndex(from, item);
      const targetIndex =
        sourceIndex === null ? null : (mapping.get(sourceIndex) ?? null);

      // 行き先も子も無い項目は落とす。
      if (targetIndex === null && children.length === 0) return null;

      const title = item.get(PDFName.of("Title"));
      const entries: { [key: string]: PdfLiteral } = {
        Title: (title as PDFObject | undefined) ?? "しおり",
        Parent: parent,
      };

      if (targetIndex !== null && targetPages[targetIndex]) {
        // 「ページの先頭へ」を意味する行き先。
        entries.Dest = to.context.obj([
          targetPages[targetIndex].ref,
          PDFName.of("Fit"),
        ]);
      }

      const dict = to.context.obj(entries) as PDFDict;
      const ref = to.context.register(dict);

      if (children.length > 0) {
        linkChildren(dict, ref, children);
      }
      return { ref, dict };
    };

    /** 兄弟をたどって順に作り直す。 */
    const copySiblings = (first: PDFDict | undefined): CopiedItem[] => {
      const copied: CopiedItem[] = [];
      let current: PDFDict | undefined = first;
      let guard = 0;

      while (current && guard < 2000) {
        // 親は後で差し替えるので、いったん自分自身を仮の親にしておく。
        const placeholder = to.context.nextRef();
        const item = copyItem(current, placeholder);
        if (item) copied.push(item);

        const next = current.lookupMaybe(PDFName.of("Next"), PDFDict);
        current = next;
        guard += 1;
      }
      return copied;
    };

    /** 子の一覧を親へつなぎ、Prev / Next も張る。 */
    const linkChildren = (
      parentDict: PDFDict,
      parentRef: PDFRef,
      children: CopiedItem[],
    ): void => {
      children.forEach((child, index) => {
        child.dict.set(PDFName.of("Parent"), parentRef);
        if (index > 0) {
          child.dict.set(PDFName.of("Prev"), children[index - 1].ref);
        }
        if (index < children.length - 1) {
          child.dict.set(PDFName.of("Next"), children[index + 1].ref);
        }
      });

      parentDict.set(PDFName.of("First"), children[0].ref);
      parentDict.set(PDFName.of("Last"), children[children.length - 1].ref);
      parentDict.set(PDFName.of("Count"), PDFNumber.of(children.length));
    };

    const topLevel = copySiblings(root.lookupMaybe(PDFName.of("First"), PDFDict));
    if (topLevel.length === 0) return;

    const outlinesDict = to.context.obj({ Type: "Outlines" }) as PDFDict;
    const outlinesRef = to.context.register(outlinesDict);
    linkChildren(outlinesDict, outlinesRef, topLevel);

    to.catalog.set(PDFName.of("Outlines"), outlinesRef);
    // しおりパネルを開いた状態で開く。
    to.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  } catch {
    // しおりの構造は文書ごとに差が大きい。引き継げなくても本体は書き出す。
  }
}
