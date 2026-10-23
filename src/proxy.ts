import { NextResponse, type NextRequest } from "next/server";
import { getDataSource } from "@/lib/config";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (getDataSource() !== "supabase") return NextResponse.next();
  return updateSupabaseSession(request);
}

export const config = {
  // 정적 파일·이미지는 제외한다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
