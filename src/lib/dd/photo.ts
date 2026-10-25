import { PHOTO_MAX_BYTES, PHOTO_MIME_TYPES } from "./config";

export type PhotoKind = { mime: (typeof PHOTO_MIME_TYPES)[number]; ext: "jpg" | "png" | "webp" };

/** 파일 앞부분(매직 바이트)으로 실제 이미지 형식을 판별한다. 클라이언트가 알려준 MIME 은 믿지 않는다. */
export function sniffImage(bytes: Uint8Array): PhotoKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return { mime: "image/png", ext: "png" };
  const ascii = (from: number, text: string) => [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  return null;
}

/** 크기·선언된 MIME·실제 형식이 모두 허용 범위인지 확인한다. */
export function validatePhoto(declaredMime: string, bytes: Uint8Array): PhotoKind | null {
  if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) return null;
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(declaredMime)) return null;
  const kind = sniffImage(bytes);
  return kind && kind.mime === declaredMime ? kind : null;
}
