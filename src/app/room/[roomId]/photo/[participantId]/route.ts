import { NextResponse, type NextRequest } from "next/server";
import { viewerRpc } from "@/lib/dd/db";
import { sniffImage } from "@/lib/dd/photo";
import { getViewer } from "@/lib/dd/session";
import { idSchema } from "@/lib/dd/validation";

/** 같은 방 참가자에게만 프로필 사진을 내려준다. 사진은 DB에 있고 공개 URL이 없다. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/room/[roomId]/photo/[participantId]">) {
  const { roomId, participantId } = await ctx.params;
  const notFound = () => new NextResponse("Not Found", { status: 404 });
  if (!idSchema.safeParse(participantId).success) return notFound();

  const viewer = await getViewer(roomId);
  if (!viewer) return notFound();

  const photo = await viewerRpc<{ mime: string; data: string } | null>(viewer, "dd_api_get_photo", {
    p_target: participantId,
  });
  if (!photo) return notFound();
  const bytes = new Uint8Array(Buffer.from(photo.data, "base64"));
  const kind = sniffImage(bytes);
  if (!kind) return notFound();

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": kind.mime,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
