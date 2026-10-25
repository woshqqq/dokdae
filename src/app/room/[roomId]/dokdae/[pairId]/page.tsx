import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConsentButton, EndPairButton, RespondButtons } from "@/components/dd/pair-controls";
import { NoAccess } from "@/components/dd/no-access";
import { PairItems } from "@/components/dd/pair-items";
import { PersonAvatar } from "@/components/dd/person-avatar";
import { Poll } from "@/components/dd/poll";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { DdError } from "@/lib/dd/errors";
import { getPairView, getPeerItems, type PairView, type PeerItems } from "@/lib/dd/queries";
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
  let items: PeerItems | null = null;
  try {
    view = await getPairView(viewer, pairId);
    // 항목은 active(열람·결제)와 closed(보상 확정)에서만 다룬다. 서버가 상태별로 내려줄 정보를 다시 제한한다.
    if (view.pair.status === "active" || view.pair.status === "closed") items = await getPeerItems(viewer, pairId);
  } catch (error) {
    if (error instanceof DdError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { pair, peer } = view;
  const live = pair.status === "requested" || pair.status === "reviewing" || pair.status === "active";

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
            상대의 소개를 보고 독대를 시작할지 정하세요. 양쪽이 모두 동의해야 시작되고, 시작된 뒤에 항목을 열어 볼 수 있어요.
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
            아래에서 토큰을 내고 상대의 항목을 열어 보세요.
          </Notice>
          <EndPairButton roomId={roomId} pairId={pair.id} label="독대 종료" confirmText="독대를 종료할까요? 종료하면 열어 본 항목의 내용은 더 이상 보이지 않아요. (보상 지급 확정은 종료 후에도 할 수 있어요.)" />
        </div>
      ) : null}

      {pair.status === "closed" || pair.status === "declined" ? (
        <Notice tone="info" title={pair.status === "closed" ? "종료된 독대예요" : "진행되지 않은 독대예요"}>
          {pair.closed_at ? `${formatTime(pair.closed_at)}에 끝났어요. ` : ""}
          상대의 소개와 항목은 더 이상 보이지 않습니다.
        </Notice>
      ) : null}

      {items ? <PairItems roomId={roomId} pairId={pair.id} status={pair.status} data={items} /> : null}

      {live ? <Poll /> : null}
    </div>
  );
}
