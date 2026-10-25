import { Suspense } from "react";
import { NoAccess } from "@/components/dd/no-access";
import { ProfileForm } from "@/components/dd/profile-form";
import { PageHeader, PageSkeleton } from "@/components/page";
import { getOverview } from "@/lib/dd/queries";
import { getViewer } from "@/lib/dd/session";

export default function ProfilePage({ params }: PageProps<"/room/[roomId]/profile">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Profile params={params} />
    </Suspense>
  );
}

async function Profile({ params }: Pick<PageProps<"/room/[roomId]/profile">, "params">) {
  const { roomId } = await params;
  const viewer = await getViewer(roomId);
  if (!viewer) return <NoAccess />;
  const { me, room } = await getOverview(viewer);
  return (
    <div className="space-y-6">
      <PageHeader title="내 프로필" back={{ href: `/room/${roomId}`, label: room.name }} />
      <ProfileForm roomId={roomId} me={{ id: me.id, nickname: me.nickname, bio: me.bio, hasPhoto: me.has_photo }} />
    </div>
  );
}
