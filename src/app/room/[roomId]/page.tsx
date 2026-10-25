import Link from "next/link";
import { Suspense } from "react";
import { NoAccess } from "@/components/dd/no-access";
import { PersonAvatar } from "@/components/dd/person-avatar";
import { RequestPairButton } from "@/components/dd/pair-controls";
import { Poll } from "@/components/dd/poll";
import { PageHeader, PageSkeleton } from "@/components/page";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState, Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { formatInviteCode } from "@/lib/dd/token";
import { getOverview } from "@/lib/dd/queries";
import { getViewer } from "@/lib/dd/session";

export default function RoomPage({ params, searchParams }: PageProps<"/room/[roomId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Room params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const statusLabel = { requested: "요청됨", reviewing: "서로 확인 중", active: "독대 진행 중", closed: "종료", declined: "거절·취소" } as const;

async function Room({ params, searchParams }: Pick<PageProps<"/room/[roomId]">, "params" | "searchParams">) {
  const { roomId } = await params;
  const query = await searchParams;
  const viewer = await getViewer(roomId);
  if (!viewer) return <NoAccess />;
  const o = await getOverview(viewer);

  const needsProfile = !o.me.has_photo && !o.me.bio;
  const openPair = o.pairs.find((p) => p.status === "reviewing" || p.status === "active");
  const incoming = o.pairs.filter((p) => p.status === "requested" && p.direction === "incoming");
  const history = o.pairs.filter((p) => p.status === "closed" || p.status === "declined");

  return (
    <div className="space-y-8">
      <PageHeader title={o.room.name} subtitle={`${o.me.nickname}(으)로 참여 중`} />

      {o.room.invite_code ? (
        <Card className="space-y-2">
          <p className="text-sm font-semibold">초대 코드</p>
          <p className="select-all font-mono text-3xl font-extrabold tracking-widest">{formatInviteCode(o.room.invite_code)}</p>
          <p className="text-sm text-muted">
            코드를 알려 주면 누구나 이 방에 입장할 수 있어요. 입장해도 다른 사람의 소개·답변은 볼 수 없습니다.
          </p>
          {query.created ? <Notice tone="success">방을 만들었어요. 먼저 내 프로필과 질문을 채워 보세요.</Notice> : null}
        </Card>
      ) : null}

      <Section title="내 준비 상태">
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <PersonAvatar roomId={roomId} id={o.me.id} nickname={o.me.nickname} hasPhoto={o.me.has_photo} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">1. 프로필</p>
              <p className="text-sm text-muted">{needsProfile ? "사진과 소개를 채워 보세요(선택)." : "작성했어요."}</p>
            </div>
            <LinkButton href={`/room/${roomId}/profile`} variant="secondary" size="sm">
              수정
            </LinkButton>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-sunken text-sm font-bold tabular-nums">
              {o.question_count}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">2. 질문과 답변</p>
              <p className="text-sm text-muted">
                {o.me.ready ? "준비를 마쳤어요." : `질문 ${o.question_count}/${o.min_questions}개 구성`}
              </p>
            </div>
            <LinkButton href={`/room/${roomId}/questions`} variant={o.me.ready ? "secondary" : "primary"} size="sm">
              {o.me.ready ? "수정" : "작성하기"}
            </LinkButton>
          </div>
        </Card>
      </Section>

      {incoming.length > 0 ? (
        <Section title="받은 독대 요청">
          <ul className="space-y-2">
            {incoming.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/room/${roomId}/dokdae/${p.id}`}
                  className="flex items-center justify-between rounded-2xl border border-brand/40 bg-brand-soft p-4 font-semibold"
                >
                  {p.peer_nickname}님이 독대를 요청했어요
                  <span aria-hidden>›</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {openPair ? (
        <Section title="진행 중인 독대">
          <Link
            href={`/room/${roomId}/dokdae/${openPair.id}`}
            className="flex items-center justify-between rounded-2xl border border-brand bg-brand-soft p-4 font-semibold"
          >
            {openPair.peer_nickname}님과 · {statusLabel[openPair.status]}
            <span aria-hidden>›</span>
          </Link>
        </Section>
      ) : null}

      <Section title="참가자">
        {o.members.length === 0 ? (
          <EmptyState title="아직 다른 참가자가 없어요">초대 코드를 공유해 보세요.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {o.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <PersonAvatar roomId={roomId} id={m.id} nickname={m.nickname} hasPhoto={m.has_photo} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{m.nickname}</p>
                  <p className="text-xs text-muted">{m.ready ? "준비 완료" : "아직 준비 중"}</p>
                </div>
                {m.pair ? (
                  <LinkButton href={`/room/${roomId}/dokdae/${m.pair.id}`} variant="secondary" size="sm">
                    {statusLabel[m.pair.status]}
                  </LinkButton>
                ) : o.me.ready && m.ready ? (
                  <RequestPairButton roomId={roomId} peerId={m.id} nickname={m.nickname} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {!o.me.ready && o.members.length > 0 ? (
          <Notice tone="info">내 질문 구성을 마치면 준비된 참가자에게 독대를 요청할 수 있어요.</Notice>
        ) : null}
      </Section>

      {history.length > 0 ? (
        <Section title="지난 독대">
          <ul className="space-y-1 text-sm text-muted">
            {history.map((p) => (
              <li key={p.id}>
                <Link href={`/room/${roomId}/dokdae/${p.id}`} className="underline-offset-2 hover:underline">
                  {p.peer_nickname}님 · {statusLabel[p.status]}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Poll />
    </div>
  );
}
