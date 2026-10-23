import { Suspense } from "react";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader, PageSkeleton } from "@/components/page";
import { EndSessionControl } from "@/components/sessions/end-session-control";
import { GiftButton } from "@/components/sessions/gift-sheet";
import { SessionQuestionCard } from "@/components/sessions/session-question-card";
import { SessionRequestActions } from "@/components/sessions/session-request-actions";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState, Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Tokens } from "@/components/ui/token";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import type { SessionView } from "@/lib/data/types";
import { formatRemaining, formatTime } from "@/lib/format";
import { load } from "@/lib/load";

export const metadata = { title: "독대" };

export default function SessionPage({ params }: PageProps<"/sessions/[sessionId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Session params={params} />
    </Suspense>
  );
}

async function Session({ params }: Pick<PageProps<"/sessions/[sessionId]">, "params">) {
  const { sessionId } = await params;
  await requireUser(`/sessions/${sessionId}`);
  const result = await load(async () => (await getRepository()).getSessionView(sessionId));

  if (!result.ok) {
    // 보관 기간 0이면 종료 즉시 기록이 삭제되므로 "없음"과 "종료"를 구분하지 않는다.
    return (
      <div className="space-y-4 py-10 text-center">
        <LiveRefresh intervalMs={10000} />
        <h1 className="text-xl font-bold">{result.code === "NOT_FOUND" ? "끝났거나 없는 독대예요" : "독대를 열 수 없어요"}</h1>
        <p className="text-muted">
          {result.code === "NOT_FOUND"
            ? "독대가 종료되어 기록이 삭제되었거나, 접근 권한이 없는 독대입니다."
            : result.message}
        </p>
        <LinkButton href="/" variant="secondary">
          내 모임으로
        </LinkButton>
      </div>
    );
  }

  const view = result.data;
  const { session, partner, room } = view;

  return (
    <div className="space-y-6">
      <LiveRefresh intervalMs={3000} />
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar seed={partner.userId} name={partner.nickname} />
            <span>{partner.nickname}님과 독대</span>
          </span>
        }
        back={{ href: `/rooms/${room.id}`, label: room.name }}
      />

      {session.status === "pending" ? <PendingPanel view={view} /> : null}
      {session.status === "active" && room.status === "active" ? <ActivePanel view={view} /> : null}
      {session.status !== "pending" && !(session.status === "active" && room.status === "active") ? (
        <EndedPanel view={view} />
      ) : null}
    </div>
  );
}

function BalanceBar({ balance, note }: { balance: number; note?: string }) {
  return (
    <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">내 토큰</span>
        <Tokens amount={balance} className="text-lg" />
      </div>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

function PendingPanel({ view }: { view: SessionView }) {
  const isRecipient = view.session.recipientId === view.me.userId;
  return (
    <Card className="space-y-4 text-center">
      <p className="text-lg font-bold">
        {isRecipient ? `${view.partner.nickname}님이 독대를 요청했어요` : `${view.partner.nickname}님의 수락을 기다리는 중`}
      </p>
      <p className="text-sm text-muted">{formatRemaining(view.session.expiresAt)} 후 요청이 만료됩니다.</p>
      <SessionRequestActions sessionId={view.session.id} mode={isRecipient ? "incoming" : "outgoing"} />
    </Card>
  );
}

function ActivePanel({ view }: { view: SessionView }) {
  const { session, partner, myBalance, partnerQuestions, endVote, settings, transactions, me } = view;
  const tradable = endVote.kind === "none";
  const unlockedCount = partnerQuestions.filter((q) => q.unlocked).length;

  return (
    <>
      <BalanceBar balance={myBalance} note="질문을 열면 토큰이 상대에게 전달됩니다." />

      <EndSessionControl sessionId={session.id} roomId={view.room.id} partnerNickname={partner.nickname} endVote={endVote} />

      <Section
        title={`${partner.nickname}님의 질문`}
        action={
          <span className="text-sm text-muted">
            {unlockedCount}/{partnerQuestions.length} 열람
          </span>
        }
      >
        {partnerQuestions.length === 0 ? (
          <EmptyState title="공개한 답변이 아직 없어요">상대가 답변을 작성하면 여기에 나타납니다.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {partnerQuestions.map((q) => (
              <li key={q.meta.id}>
                <SessionQuestionCard
                  sessionId={session.id}
                  question={q}
                  balance={myBalance}
                  tradable={tradable}
                  partnerNickname={partner.nickname}
                  gift={settings.giftsEnabled ? settings : null}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {settings.giftsEnabled ? (
        <Card className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">대화가 즐거웠나요?</p>
            <p className="text-sm text-muted">질문 열기와 별개로 토큰을 보낼 수 있어요.</p>
          </div>
          <GiftButton
            sessionId={session.id}
            balance={myBalance}
            partnerNickname={partner.nickname}
            settings={settings}
            disabled={!tradable}
          />
        </Card>
      ) : null}

      <Section title="이번 독대 기록">
        {transactions.length === 0 ? (
          <p className="text-sm text-muted">아직 주고받은 토큰이 없어요.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {transactions.map((t) => {
              const sent = t.senderId === me.userId;
              const label =
                t.type === "unlock_payment" ? (sent ? "질문 열기" : "내 질문이 열림") : sent ? "토큰 보냄" : "토큰 받음";
              return (
                <li key={t.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    {label}
                    <span className="ml-2 text-muted">{formatTime(t.createdAt)}</span>
                  </span>
                  <span className={sent ? "font-semibold tabular-nums text-muted" : "font-semibold tabular-nums text-success"}>
                    {sent ? "−" : "+"}
                    {t.amount}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {endVote.kind === "none" ? <div aria-hidden className="h-16" /> : null}
    </>
  );
}

function EndedPanel({ view }: { view: SessionView }) {
  const { session, room, settings } = view;
  const copy: Record<string, { title: string; body: string }> = {
    closed: { title: "종료된 독대예요", body: "양쪽 모두 종료에 동의했습니다. 열람했던 답변은 더 이상 볼 수 없어요." },
    rejected: { title: "거절된 요청이에요", body: "상대가 독대 요청을 거절했습니다." },
    cancelled: { title: "취소된 요청이에요", body: "독대 요청이 취소되었습니다." },
    expired: { title: "만료된 요청이에요", body: "수락 대기 시간이 지나 요청이 만료되었습니다." },
    active: { title: "모임이 종료되었어요", body: "종료된 모임에서는 독대를 이어갈 수 없습니다." },
  };
  const c = copy[session.status] ?? copy.closed;
  return (
    <div className="space-y-4">
      <Notice tone="info" title={c.title}>
        {c.body}
      </Notice>
      {session.status === "closed" && settings.sessionRetentionDays > 0 ? (
        <p className="text-sm text-muted">
          모임 설정에 따라 이 독대 기록은 {settings.sessionRetentionDays}일 동안 보관된 뒤 삭제됩니다. 보관 중에도 답변은
          공개되지 않습니다.
        </p>
      ) : null}
      {room.status === "active" ? (
        <LinkButton href={`/rooms/${room.id}`} size="lg">
          모임으로 돌아가기
        </LinkButton>
      ) : (
        <LinkButton href="/" size="lg" variant="secondary">
          처음으로
        </LinkButton>
      )}
    </div>
  );
}
