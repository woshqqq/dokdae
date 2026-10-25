import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConsentButton, EndPairButton, RespondButtons } from "@/components/dd/pair-controls";
import { NoAccess } from "@/components/dd/no-access";
import { PersonAvatar } from "@/components/dd/person-avatar";
import { Poll } from "@/components/dd/poll";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Card, Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { DdError } from "@/lib/dd/errors";
import { defaultNumbers, getPairView, type PairView } from "@/lib/dd/queries";
import { getViewer } from "@/lib/dd/session";
import { formatTime } from "@/lib/format";

export default function PairPage({ params }: PageProps<"/room/[roomId]/dokdae/[pairId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Pair params={params} />
    </Suspense>
  );
}

async function Pair({ params }: Pick<PageProps<"/room/[roomId]/dokdae/[pairId]">, "params">) {
  const { roomId, pairId } = await params;
  const viewer = await getViewer(roomId);
  if (!viewer) return <NoAccess />;

  let view: PairView;
  try {
    view = await getPairView(viewer, pairId);
  } catch (error) {
    if (error instanceof DdError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { pair, peer } = view;
  const live = pair.status === "requested" || pair.status === "reviewing" || pair.status === "active";
  const numbers = defaultNumbers(peer.answers ?? []);

  return (
    <div className="space-y-6">
      <PageHeader title={`${peer.nickname}님과의 독대`} back={{ href: `/room/${roomId}`, label: "방으로" }} />

      <Card className="flex items-center gap-4">
        <PersonAvatar roomId={roomId} id={peer.id} nickname={peer.nickname} hasPhoto={peer.has_photo} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{peer.nickname}</p>
          {peer.bio ? <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{peer.bio}</p> : null}
        </div>
      </Card>

      {pair.status === "requested" && pair.direction === "outgoing" ? (
        <div className="space-y-3">
          <Notice tone="info">상대가 수락하면 서로의 소개와 답변을 확인할 수 있어요. 수락 전에는 아무것도 공개되지 않습니다.</Notice>
          <EndPairButton roomId={roomId} pairId={pair.id} label="요청 취소" confirmText="독대 요청을 취소할까요?" />
        </div>
      ) : null}

      {pair.status === "requested" && pair.direction === "incoming" ? (
        <div className="space-y-3">
          <Notice tone="info">
            수락하면 서로의 소개와 답변이 상대에게도 열립니다. 이후 양쪽이 모두 동의해야 독대가 시작돼요.
          </Notice>
          <RespondButtons roomId={roomId} pairId={pair.id} />
        </div>
      ) : null}

      {pair.status === "reviewing" ? (
        <div className="space-y-3">
          <Notice tone="warn" title="서로 확인하는 중이에요">
            아래 내용을 보고 독대를 시작할지 정하세요. 양쪽이 모두 동의해야 시작되고, 그만두면 상대의 내용은 다시 가려집니다.
            {pair.peer_consent ? " 상대는 이미 동의했어요." : ""}
          </Notice>
          <ConsentButton roomId={roomId} pairId={pair.id} consented={pair.my_consent} />
          <EndPairButton roomId={roomId} pairId={pair.id} label="독대 그만두기" confirmText="독대를 그만둘까요? 상대의 내용은 다시 가려집니다." />
        </div>
      ) : null}

      {pair.status === "active" ? (
        <div className="space-y-3">
          <Notice tone="success" title="독대가 시작됐어요">
            {pair.started_at ? `${formatTime(pair.started_at)}에 양쪽이 동의해 시작했어요. ` : ""}
            마주 보고 이야기를 나눠 보세요.
          </Notice>
          <EndPairButton roomId={roomId} pairId={pair.id} label="독대 종료" confirmText="독대를 종료할까요? 종료하면 상대의 소개와 답변이 다시 가려집니다." />
        </div>
      ) : null}

      {pair.status === "closed" || pair.status === "declined" ? (
        <Notice tone="info" title={pair.status === "closed" ? "종료된 독대예요" : "진행되지 않은 독대예요"}>
          {pair.closed_at ? `${formatTime(pair.closed_at)}에 끝났어요. ` : ""}
          상대의 소개와 답변은 더 이상 보이지 않습니다.
        </Notice>
      ) : null}

      {peer.answers ? (
        <Section title={`${peer.nickname}님의 답변`}>
          <ul className="space-y-3">
            {peer.answers.map((a) => (
              <li key={a.id}>
                <Card className="space-y-2">
                  <p className="text-xs font-bold text-brand">
                    {a.kind === "default" ? `${numbers.get(a.id)} · ${a.title}` : "나의 질문"}
                  </p>
                  <p className="font-semibold leading-snug">{a.body}</p>
                  {a.answer ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{a.answer}</p>
                  ) : (
                    <p className="text-sm text-muted">건너뛴 질문이에요.</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {live ? <Poll /> : null}
    </div>
  );
}
