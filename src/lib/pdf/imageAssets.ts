import { PdfEditorError } from "./errors";
import { createId } from "./elementDefaults";

/**
 * 貼り付けた画像の実体を持つ置き場。
 *
 * 画像バイト列を編集履歴（EditorDoc）へ入れると Undo のたびに数MBを
 * コピーすることになるため、要素側は assetId だけを持ち、実体はここで
 * 参照する。プレビュー用の Blob URL も併せて管理し、破棄まで面倒を見る。
 */
export interface ImageAsset {
  id: string;
  bytes: Uint8Array;
  format: "png" | "jpg";
  /** 元画像のピクセル寸法。貼り付け時の縦横比に使う。 */
  width: number;
  height: number;
  /** <image> タグ用。破棄時に revoke する。 */
  objectUrl: string;
}

export class ImageAssetStore {
  private assets = new Map<string, ImageAsset>();

  get(id: string): ImageAsset | undefined {
    return this.assets.get(id);
  }

  async add(file: File): Promise<ImageAsset> {
    const format = detectFormat(file);
    if (!format) {
      throw new PdfEditorError(
        `「${file.name}」は対応していない画像形式です。PNG または JPEG を選んでください。`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const objectUrl = URL.createObjectURL(
      new Blob([bytes.slice()], { type: file.type || `image/${format}` }),
    );

    let size: { width: number; height: number };
    try {
      size = await readImageSize(objectUrl);
    } catch (cause) {
      URL.revokeObjectURL(objectUrl);
      throw new PdfEditorError("画像の読み込みに失敗しました。", { cause });
    }

    const asset: ImageAsset = {
      id: createId("asset"),
      bytes,
      format,
      width: size.width,
      height: size.height,
      objectUrl,
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  /** 自動保存から復元した画像を、そのままの id で登録し直す。 */
  restore(stored: {
    id: string;
    format: "png" | "jpg";
    width: number;
    height: number;
    bytes: Uint8Array;
  }): ImageAsset {
    const existing = this.assets.get(stored.id);
    if (existing) return existing;

    const objectUrl = URL.createObjectURL(
      new Blob([stored.bytes.slice()], { type: `image/${stored.format}` }),
    );
    const asset: ImageAsset = { ...stored, objectUrl };
    this.assets.set(asset.id, asset);
    return asset;
  }

  /** すべての Blob URL を解放する。 */
  dispose(): void {
    for (const asset of this.assets.values()) {
      URL.revokeObjectURL(asset.objectUrl);
    }
    this.assets.clear();
  }
}

function detectFormat(file: File): "png" | "jpg" | null {
  const type = file.type.toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  if (/\.png$/i.test(file.name)) return "png";
  if (/\.jpe?g$/i.test(file.name)) return "jpg";
  return null;
}

function readImageSize(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("decode failed"));
    image.src = url;
  });
}
