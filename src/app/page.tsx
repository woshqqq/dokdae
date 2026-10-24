import Link from "next/link";
import { Suspense } from "react";
import { signInAsMockUser } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { PageSkeleton } from "@/components/page";
import { JoinRoomForm } from "@/components/rooms/join-room-form";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState, Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Tokens } from "@/components/ui/token";
import { getAuthContext, getCurrentUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { MOCK_DEMO_INVITE_CODE, MOCK_USERS } from "@/lib/data/mock/store";
import { isTestModeEnabled } from "@/lib/test-mode/config";

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "";
  const user = await getCurrentUser();

  if (!user) {
    const { kind } = await getAuthContext();
    return (
      <div className="space-y-8">
        <Intro />
        {next ? <Notice tone="warn">로그인이 필요한 화면입니다. 먼저 로그인해 주세요.</Notice> : null}
        {params.error === "auth_callback" ? (
          <Notice tone="error">인증 링크가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.</Notice>
        ) : null}
        {kind === "supabase" ? <AuthForm next={next} /> : <MockSignIn next={next} testMode={kind === "test"} />}
        {kind === "supabase" && isTestModeEnabled() ? (
          <p className="text-center text-sm text-muted">
            회원가입 없이 둘러보려면{" "}
            <Link href="/test-login" className="font-semibold text-brand underline-offset-2 hover:underline">
              비회원 테스트 모드
            </Link>
            로 들어가세요.
          </p>
        ) : null}
      </div>
    );
  }

  const rooms = await (await getRepository()).listMyRooms();
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted">안녕하세요, {user.displayName}님</p>
        <h1 className="mt-1 text-2xl font-bold">오늘은 누구와 독대할까요?</h1>
      </div>

      <Section title="내 모임">
        {rooms.length === 0 ? (
          <EmptyState title="아직 참여한 모임이 없어요">모임 코드를 받아 입장하거나 새 모임을 만들어 보세요.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {rooms.map((r) => (
              <li key={r.room.id}>
                <Link
                  href={`/rooms/${r.room.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-brand/40"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{r.room.name}</span>
                      {r.role === "owner" ? (
                        <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand">운영자</span>
                      ) : null}
                      {r.room.status === "closed" ? (
                        <span className="rounded-md bg-sunken px-1.5 py-0.5 text-xs font-semibold text-muted">종료됨</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted">{r.nickname}(으)로 참여 중</span>
                  </span>
                  <Tokens amount={r.balance} className="text-base" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="모임 코드로 입장">
        <Card>
          <JoinRoomForm defaultNickname={user.displayName.replace(/\s*\(.*\)$/, "")} />
        </Card>
      </Section>

      <LinkButton href="/rooms/new" variant="secondary" size="lg">
        새 모임 만들기
      </LinkButton>
    </div>
  );
}

function Intro() {
  return (
    <div className="space-y-4 pt-4">
      <h1 className="text-3xl font-extrabold leading-snug">
        마주 앉아,
        <br />
        한 사람에게 집중하는 시간
      </h1>
      <p className="leading-relaxed text-muted">
        독대는 같은 모임 사람과 1:1로 대화할 때 쓰는 도구예요. 상대의 답변은 가려져 있고, 토큰을 내고 하나씩 열어보며
        대화를 이어갑니다. 마음에 드는 이야기에는 토큰을 보내 고마움을 표현할 수 있어요.
      </p>
      <ul className="grid grid-cols-3 gap-2 text-center text-sm">
        {["모임 코드로 입장", "블라인드 답변 열기", "양쪽 동의로 종료"].map((t) => (
          <li key={t} className="rounded-xl bg-surface px-2 py-3 font-medium">
            {t}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">토큰은 앱 안에서만 쓰는 포인트로, 현금 가치가 없습니다.</p>
    </div>
  );
}

function MockSignIn({ next, testMode }: { next: string; testMode: boolean }) {
  return (
    <Section title="데모 사용자로 시작하기">
      <Notice tone="warn">
        실제 로그인이 아닌 <strong>임시 사용자 전환</strong>입니다.{" "}
        {testMode
          ? "다른 브라우저(또는 시크릿 창)에서 상단의 공간 코드로 같은 테스트 공간에 들어가 서로 다른 사용자를 고르면 독대 흐름을 확인할 수 있어요."
          : "두 브라우저(또는 시크릿 창)에서 서로 다른 사용자를 골라 독대 흐름을 확인할 수 있어요."}{" "}
        데모 모임 코드: <strong className="font-mono">{MOCK_DEMO_INVITE_CODE}</strong>
      </Notice>
      <div className="grid grid-cols-2 gap-2">
        {MOCK_USERS.map((u) => (
          <form key={u.id} action={signInAsMockUser}>
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 text-left hover:border-brand/40"
            >
              <Avatar seed={u.id} name={u.displayName} />
              <span className="text-sm font-semibold leading-tight">{u.displayName}</span>
            </button>
          </form>
        ))}
      </div>
    </Section>
  );
}
