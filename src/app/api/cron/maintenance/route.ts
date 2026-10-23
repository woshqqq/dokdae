import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDataSource } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 예약 정리: 만료된 독대 요청 처리, 보관 기간이 지난 독대·모임 삭제. 재실행해도 안전하다.
 * Vercel Cron(vercel.json)이 호출하며, CRON_SECRET 이 설정되어 있으면 Authorization: Bearer <CRON_SECRET> 을 보낸다.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });

  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (getDataSource() !== "supabase") {
    // mock 모드는 요청마다 정리 작업을 실행하므로 할 일이 없다.
    return NextResponse.json({ skipped: "mock data source" });
  }

  const { data, error } = await createSupabaseAdminClient().rpc("run_maintenance");
  if (error) {
    console.error("run_maintenance failed", error);
    return NextResponse.json({ error: "maintenance failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: data });
}
