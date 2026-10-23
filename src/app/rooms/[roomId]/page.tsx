import Link from "next/link";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/live-refresh";
import { AccessDenied, PageHeader, PageSkeleton } from "@/components/page";
import { SessionRequestActions } from "@/components/sessions/session-request-actions";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState, Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Tokens } from "@/components/ui/token";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { load } from "@/lib/load";
import { formatRemaining } from "@/lib/format";

export default function RoomPage({ params, searchParams }: PageProps<"/rooms/[roomId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RoomDashboard params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RoomDashboard({ params, searchParams }: PageProps<"/rooms/[roomId]">) {
  const { roomId } = await params;
  const query = await searchParams;
  await requireUser(`/rooms/${roomId}`);
  const result = await load(async () => (await getRepository()).getRoomDashboard(roomId));
  if (!result.ok) return <AccessDenied code={result.code} message={result.message} />;
  const { room, me, balance, members, incomingRequests, outgoingRequests, activeSessions, settings } = result.data;
  const isOwner = me.role === "owner";
  const closed = room.status === "closed";

  return (
    <div className="space-y-7">
      <LiveRefresh intervalMs={5000} />
      <PageHeader
        title={room.name}
        subtitle={room.description || undefined}
        back={{ href: "/", label: "내 모임" }}
        action={
          isOwner ? (
            <LinkButton href={`/rooms/${roomId}/settings`} variant="secondary" size="sm">
              설정
            </LinkButton>
          ) : null
        }
      />

      {query.joined ? <Notice tone="success">모임에 입장했어요. 토큰 {settings.initialTokens}개를 받았습니다.</Notice> : null}
      {query.rejoined ? <Notice>이미 참여 중인 모임이에요. 초기 토큰은 다시 지급되지 않습니다.</Notice> : null}
      {query.ended ? <Notice tone="success">독대를 마쳤어요. 열람 권한은 종료와 함께 사라졌습니다.</Notice> : null}
      {closed ? <Notice tone="warn" title="종료된 모임입니다">새 독대와 토큰 거래를 할 수 없습니다.</Notice> : null}

      <Card className="flex items-center justify-between gap-4 bg-token-soft">
        <div>
          <p className="text-sm text-muted">{me.nickname}님의 토큰</p>
          <Tokens amount={balance} className="mt-1 text-3xl" />
        </div>
        <LinkButton href={`/rooms/${roomId}/profile`} variant="secondary">
          내 프로필
        </LinkButton>
      </Card>

      {incomingRequests.length > 0 ? (
        <Section title={`받은 독대 요청 ${incomingRequests.length}`}>
          <ul className="space-y-2">
            {incomingRequests.map((s) => (
              <li key={s.id}>
                <Card className="space-y-3 border-brand/40">
                  <div className="flex items-center gap-3">
                    <Avatar seed={s.partner.userId} name={s.partner.nickname} />
                    <div className="min-w-0">
                      <p className="font-semibold">{s.partner.nickname}님이 독대를 요청했어요</p>
                      <p className="text-sm text-muted">{formatRemaining(s.expiresAt)} 후 만료</p>
                    </div>
                  </div>
                  <SessionRequestActions sessionId={s.id} mode="incoming" />
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="진행 중인 독대">
        {activeSessions.length === 0 ? (
          <EmptyState title="진행 중인 독대가 없어요">참여자를 골라 독대를 요청해 보세요.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {activeSessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-surface p-4 hover:bg-brand-soft"
                >
                  <Avatar seed={s.partner.userId} name={s.partner.nickname} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{s.partner.nickname}님과 독대 중</span>
                    <span className="block text-sm text-muted">
                      {s.endRequested ? "종료 확인이 필요해요" : "눌러서 독대 화면 열기"}
                    </span>
                  </span>
                  <span aria-hidden className="text-xl text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {outgoingRequests.length > 0 ? (
        <Section title="보낸 요청">
          <ul className="space-y-2">
            {outgoingRequests.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center gap-3">
                  <Avatar seed={s.partner.userId} name={s.partner.nickname} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.partner.nickname}님의 수락을 기다리는 중</p>
                    <p className="text-sm text-muted">{formatRemaining(s.expiresAt)} 후 만료</p>
                  </div>
                  <SessionRequestActions sessionId={s.id} mode="outgoing" />
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="참여자">
        {members === null ? (
          <EmptyState title="참여자 목록이 비공개예요">운영자가 참여자 목록을 공개하지 않도록 설정했습니다.</EmptyState>
        ) : members.length <= 1 ? (
          <EmptyState title="아직 다른 참여자가 없어요">운영자에게 받은 모임 코드를 다른 사람에게 알려 주세요.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {members.map((m) => (
              <li key={m.userId}>
                <Link
                  href={`/rooms/${roomId}/members/${m.userId}`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-sunken"
                >
                  <Avatar seed={m.userId} name={m.nickname} />
                  <span className="flex-1 font-semibold">
                    {m.nickname}
                    {m.userId === me.userId ? <span className="ml-1.5 text-sm font-normal text-muted">(나)</span> : null}
                  </span>
                  {m.role === "owner" ? (
                    <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand">운영자</span>
                  ) : null}
                  <span aria-hidden className="text-xl text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
