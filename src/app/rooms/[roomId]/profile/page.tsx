import { Suspense } from "react";
import { AccessDenied, PageHeader, PageSkeleton } from "@/components/page";
import { ProfileForm } from "@/components/profile/profile-form";
import { Notice } from "@/components/ui/notice";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { load } from "@/lib/load";

export const metadata = { title: "내 프로필" };

export default function ProfilePage({ params }: PageProps<"/rooms/[roomId]/profile">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Profile params={params} />
    </Suspense>
  );
}

async function Profile({ params }: Pick<PageProps<"/rooms/[roomId]/profile">, "params">) {
  const { roomId } = await params;
  await requireUser(`/rooms/${roomId}/profile`);
  const result = await load(async () => (await getRepository()).getProfileEditor(roomId));
  if (!result.ok) return <AccessDenied code={result.code} message={result.message} />;
  const editor = result.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="내 프로필"
        subtitle="답변은 상대가 토큰을 내고 열기 전까지 가려져 있어요."
        back={{ href: `/rooms/${roomId}`, label: editor.room.name }}
      />
      {editor.room.status === "closed" ? (
        <Notice tone="warn">종료된 모임이라 프로필을 수정할 수 없습니다.</Notice>
      ) : (
        <ProfileForm editor={editor} />
      )}
    </div>
  );
}
