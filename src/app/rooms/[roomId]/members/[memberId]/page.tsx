import { Suspense } from "react";
import { LiveRefresh } from "@/components/live-refresh";
import { AccessDenied, PageHeader, PageSkeleton } from "@/components/page";
import { BlindQuestionCard } from "@/components/sessions/blind-question-card";
import { RequestSessionButton } from "@/components/sessions/request-session-button";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState, Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { load } from "@/lib/load";

export default function MemberPage({ params }: PageProps<"/rooms/[roomId]/members/[memberId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Member params={params} />
    </Suspense>
  );
}

async function Member({ params }: Pick<PageProps<"/rooms/[roomId]/members/[memberId]">, "params">) {
  const { roomId, memberId } = await params;
  await requireUser(`/rooms/${roomId}/members/${memberId}`);
  const result = await load(async () => (await getRepository()).getMemberProfile(roomId, memberId));
  if (!result.ok) return <AccessDenied code={result.code} message={result.message} />;
  const { room, member, isMe, questions, openSession, canRequest } = result.data;

  return (
    <div className="space-y-6">
      <LiveRefresh intervalMs={5000} />
      <PageHeader title={isMe ? "내 프로필 미리보기" : `${member.nickname}님`} back={{ href: `/rooms/${roomId}`, label: room.name }} />

      <Card className="flex items-center gap-4">
        <Avatar seed={member.userId} name={member.nickname} size="lg" />
        <div>
          <p className="text-lg font-bold">{member.nickname}</p>
          <p className="text-sm text-muted">공개한 질문 {questions.length}개</p>
        </div>
      </Card>

      {isMe ? (
        <Notice>
          다른 참여자에게는 이렇게 보여요. 답변 원문은 독대 중에 상대가 열어야만 보입니다.{" "}
          <LinkButton href={`/rooms/${roomId}/profile`} variant="ghost" size="sm" className="underline">
            프로필 수정
          </LinkButton>
        </Notice>
      ) : openSession ? (
        <Card className="space-y-3 border-brand/40">
          <p className="font-semibold">
            {openSession.status === "active"
              ? "지금 이 분과 독대 중이에요."
              : openSession.isRequester
                ? "독대 요청을 보냈어요. 수락을 기다리는 중입니다."
                : "이 분이 독대를 요청했어요."}
          </p>
          <LinkButton href={openSession.status === "active" ? `/sessions/${openSession.id}` : `/rooms/${roomId}`} size="lg">
            {openSession.status === "active" ? "독대 화면으로" : "요청 확인하기"}
          </LinkButton>
        </Card>
      ) : canRequest.ok ? (
        <RequestSessionButton roomId={roomId} recipientId={member.userId} nickname={member.nickname} />
      ) : (
        <Notice tone="warn">{canRequest.reason}</Notice>
      )}

      <Section title="질문">
        {questions.length === 0 ? (
          <EmptyState title="아직 공개한 답변이 없어요">답변을 작성하면 여기에 질문이 표시됩니다.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {questions.map((q) => (
              <li key={q.id}>
                <BlindQuestionCard label={q.label} cost={q.tokenCost} hint={isMe ? "내 답변" : "독대 중에 열 수 있어요"} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
