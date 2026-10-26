import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { CreateRoomForm, JoinRoomForm } from "@/components/dd/entry-forms";
import { PageSkeleton } from "@/components/page";
import { Card, Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PARTICIPANT_COOKIE_PREFIX } from "@/lib/dd/config";
import { DdError } from "@/lib/dd/errors";
import { getOverview } from "@/lib/dd/queries";
import { getViewer } from "@/lib/dd/session";

export default function HomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Home />
    </Suspense>
  );
}

/** 이 브라우저에 참가자 쿠키가 있고 서버 검증을 통과하는 방들. 쿠키가 없는 방은 목록에 나타나지 않는다. */
async function myRooms() {
  const roomIds = (await cookies())
    .getAll()
    .filter((c) => c.name.startsWith(PARTICIPANT_COOKIE_PREFIX))
    .map((c) => c.name.slice(PARTICIPANT_COOKIE_PREFIX.length))
    .slice(0, 10);
  const rooms = await Promise.all(
    roomIds.map(async (roomId) => {
      const viewer = await getViewer(roomId);
      if (!viewer) return null;
      const overview = await getOverview(viewer);
      return { id: roomId, name: overview.room.name, nickname: overview.me.nickname };
    }),
  );
  return rooms.filter((r) => r !== null);
}

async function Home() {
  let rooms: Awaited<ReturnType<typeof myRooms>> = [];
  let problem: string | null = null;
  try {
    rooms = await myRooms();
  } catch (error) {
    problem = error instanceof DdError ? error.message : new DdError("INTERNAL").message;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3 pt-2">
        <h1 className="text-3xl font-extrabold leading-snug">
          NT모임,
          <br />
          독대의 공간
        </h1>
        <p className="leading-relaxed text-muted">
          가입 없이 방을 만들거나 초대 코드로 입장하세요. 서로 동의한 상대에게만 내 이야기가 열립니다.
        </p>
      </div>

      {problem ? <Notice tone="error">{problem}</Notice> : null}

      {rooms.length > 0 ? (
        <Section title="이 기기에서 입장한 방">
          <ul className="space-y-2">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/room/${r.id}`}
                  className="block rounded-2xl border border-line bg-surface p-4 hover:border-brand/40"
                >
                  <span className="block truncate font-semibold">{r.name}</span>
                  <span className="mt-0.5 block truncate text-sm text-muted">{r.nickname}(으)로 참여 중</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="초대 코드로 입장">
        <Card>
          <JoinRoomForm />
        </Card>
      </Section>

      <Section title="새 방 만들기">
        <Card>
          <CreateRoomForm />
        </Card>
      </Section>

      <p className="text-xs leading-relaxed text-muted">
        이 기기의 브라우저가 입장 증표를 가지고 있어요. 브라우저 데이터를 지우거나 다른 기기로 바꾸면 같은 참가자로 돌아올 수
        없습니다.
      </p>
    </div>
  );
}
