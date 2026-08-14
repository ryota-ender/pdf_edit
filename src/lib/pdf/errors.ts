/**
 * ユーザーへそのまま表示してよい日本語メッセージを持つエラー。
 * ライブラリ由来の英語メッセージはここで日本語に翻訳してから投げる。
 */
export class PdfEditorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PdfEditorError";
  }
}

/** 想定外の例外も含め、必ず日本語の文言を取り出す。 */
export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof PdfEditorError) return error.message;
  if (error instanceof Error && error.message) {
    return `${fallback}（${error.message}）`;
  }
  return fallback;
}

/** pdf.js が投げる例外を日本語のエラーへ変換する。 */
export function translatePdfJsError(error: unknown): PdfEditorError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (name === "PasswordException") {
    return new PdfEditorError(
      "このPDFはパスワードで保護されています。保護を解除したファイルを読み込んでください。",
      { cause: error },
    );
  }
  if (name === "InvalidPDFException") {
    return new PdfEditorError(
      "PDFファイルが破損しているため読み込めませんでした。",
      { cause: error },
    );
  }
  if (name === "MissingPDFException") {
    return new PdfEditorError("PDFファイルが見つかりませんでした。", {
      cause: error,
    });
  }
  if (/worker/i.test(message)) {
    return new PdfEditorError(
      "PDF表示エンジン (PDF.js) の読み込みに失敗しました。ページを再読み込みしてください。",
      { cause: error },
    );
  }

  return new PdfEditorError(`PDFの読み込みに失敗しました。（${message}）`, {
    cause: error,
  });
}

/** pdf-lib が投げる例外を日本語のエラーへ変換する。 */
export function translatePdfLibError(error: unknown): PdfEditorError {
  const message = error instanceof Error ? error.message : String(error);

  if (/encrypted/i.test(message)) {
    return new PdfEditorError(
      "このPDFは暗号化されているため書き出せません。保護を解除したファイルを読み込んでください。",
      { cause: error },
    );
  }

  return new PdfEditorError(`PDFの書き出しに失敗しました。（${message}）`, {
    cause: error,
  });
}
