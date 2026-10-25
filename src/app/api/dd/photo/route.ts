import { NextResponse, type NextRequest } from "next/server";
import { PHOTO_MAX_BYTES } from "@/lib/dd/config";
import { viewerRpc } from "@/lib/dd/db";
import { DdError } from "@/lib/dd/errors";
import { validatePhoto } from "@/lib/dd/photo";
import { getViewer } from "@/lib/dd/session";

/**
 * 프로필 사진 업로드. 쿠키의 참가자 토큰을 확인하고, 크기·MIME·실제 파일 형식을 검증한 뒤 DB 함수로 저장한다
 * (DB 함수도 같은 검증을 다시 한다). 사진은 항상 본인 것으로만 저장된다(대상 참가자 ID를 입력으로 받지 않는다).
 */
export async function POST(request: NextRequest) {
  // 교차 출처 요청 방어(쿠키는 SameSite=Lax 라 교차 출처 POST에는 붙지 않지만 한 번 더 확인한다).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // 본문을 다 읽기 전에 크기부터 거른다.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > PHOTO_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: new DdError("PHOTO_INVALID").message }, { status: 413 });

  try {
    const form = await request.formData();
    const roomId = form.get("roomId");
    const file = form.get("file");
    if (typeof roomId !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: new DdError("VALIDATION").message }, { status: 400 });
    }
    const viewer = await getViewer(roomId);
    if (!viewer) return NextResponse.json({ error: new DdError("UNAUTHENTICATED").message }, { status: 401 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = validatePhoto(file.type, bytes);
    if (!kind) return NextResponse.json({ error: new DdError("PHOTO_INVALID").message }, { status: 400 });

    // PostgREST bytea 입력은 "\x" + 16진수 문자열
    await viewerRpc(viewer, "dd_api_set_photo", { p_mime: kind.mime, p_data: "\\x" + Buffer.from(bytes).toString("hex") });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DdError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "PHOTO_INVALID" ? 400 : 500 });
    }
    console.error("photo upload failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: new DdError("INTERNAL").message }, { status: 500 });
  }
}
