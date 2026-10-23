import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { CreateRoomForm } from "@/components/rooms/create-room-form";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "모임 만들기" };

export default function NewRoomPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="새 모임 만들기"
        subtitle="모임을 만들면 운영자가 되어 설정과 질문 목록을 관리할 수 있어요."
        back={{ href: "/", label: "처음으로" }}
      />
      <Suspense fallback={<PageSkeleton />}>
        <NewRoom />
      </Suspense>
    </div>
  );
}

async function NewRoom() {
  const user = await requireUser("/rooms/new");
  return <CreateRoomForm defaultNickname={user.displayName.replace(/\s*\(.*\)$/, "")} />;
}
