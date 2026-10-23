import { Suspense } from "react";
import { AccessDenied, PageHeader, PageSkeleton } from "@/components/page";
import { CloseRoomPanel } from "@/components/settings/close-room-panel";
import { InviteCodePanel } from "@/components/settings/invite-code-panel";
import { RoomInfoForm } from "@/components/settings/room-info-form";
import { SettingsForm } from "@/components/settings/settings-form";
import { TemplateManager } from "@/components/settings/template-manager";
import { Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { load } from "@/lib/load";

export const metadata = { title: "모임 설정" };

export default function SettingsPage({ params }: PageProps<"/rooms/[roomId]/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: Pick<PageProps<"/rooms/[roomId]/settings">, "params">) {
  const { roomId } = await params;
  await requireUser(`/rooms/${roomId}/settings`);
  const result = await load(async () => (await getRepository()).getRoomAdmin(roomId));
  if (!result.ok) return <AccessDenied code={result.code} message={result.message} backHref={`/rooms/${roomId}`} />;
  const { room, settings, templates, memberCount } = result.data;
  const closed = room.status === "closed";

  return (
    <div className="space-y-8">
      <PageHeader title="모임 설정" subtitle={`참여자 ${memberCount}명 · 운영자만 볼 수 있어요`} back={{ href: `/rooms/${roomId}`, label: room.name }} />

      {closed ? <Notice tone="warn">종료된 모임입니다. 설정을 바꿔도 새 참여·독대는 열리지 않습니다.</Notice> : null}

      <Section title="모임 정보">
        <RoomInfoForm roomId={roomId} name={room.name} description={room.description} />
      </Section>

      <Section title="초대 코드">
        <InviteCodePanel roomId={roomId} disabled={closed} />
      </Section>

      <Section title="토큰과 독대 규칙">
        <SettingsForm roomId={roomId} initial={settings} />
      </Section>

      <Section title="질문 목록">
        <TemplateManager
          roomId={roomId}
          templates={templates}
          minCost={settings.minQuestionCost}
          maxCost={settings.maxQuestionCost}
          defaultCost={settings.defaultQuestionCost}
        />
      </Section>

      {!closed ? (
        <Section title="모임 종료">
          <CloseRoomPanel roomId={roomId} roomName={room.name} retentionDays={settings.roomRetentionDays} />
        </Section>
      ) : null}
    </div>
  );
}
