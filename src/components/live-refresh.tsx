import { getAuthContext } from "@/lib/auth/session";
import { LiveRefreshClient } from "./live-refresh-client";

/**
 * 서버 상태(잔액·열람·독대 상태)를 화면에 다시 반영한다.
 *
 * - mock(테스트 세션 포함): 일정 주기로 서버 컴포넌트를 다시 불러온다(실시간 구독 아님).
 * - supabase: Realtime 변경 이벤트가 오면 다시 불러오고, 끊김에 대비해 느린 주기 재조회를 병행한다.
 *   탭 복귀·네트워크 복구 시에도 다시 불러오므로 서버 상태와 어긋나지 않는다.
 */
export async function LiveRefresh({ intervalMs }: { intervalMs?: number }) {
  const { kind } = await getAuthContext();
  return <LiveRefreshClient mode={kind === "supabase" ? "supabase" : "mock"} intervalMs={intervalMs} />;
}
