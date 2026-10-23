import "server-only";
import { emptyDb, type MockDb, type MockUser } from "./db";
import * as engine from "./engine";

// 임시 데이터는 서버 프로세스 메모리에만 있다. 서버를 재시작하면 시드 상태로 돌아간다.
// 개발 서버 HMR에도 유지되도록 globalThis에 둔다.

export const MOCK_USERS: MockUser[] = [
  { id: "mock-user-minji", displayName: "민지" },
  { id: "mock-user-junho", displayName: "준호" },
  { id: "mock-user-seoyeon", displayName: "서연" },
  { id: "mock-user-doyun", displayName: "도윤 (모임 미가입)" },
];

export const MOCK_DEMO_INVITE_CODE = "DEMO-2026";

function seed(): MockDb {
  const db = emptyDb();
  db.users = [...MOCK_USERS];
  const now = new Date();
  const as = (actorId: string) => ({ db, actorId, now });

  const { roomId } = engine.createRoomWithCode(
    as("mock-user-minji"),
    { name: "가을 독서 모임", description: "임시 데이터로 만든 데모 모임입니다.", nickname: "민지" },
    MOCK_DEMO_INVITE_CODE,
  );
  engine.joinRoom(as("mock-user-junho"), { inviteCode: MOCK_DEMO_INVITE_CODE, nickname: "준호" });
  engine.joinRoom(as("mock-user-seoyeon"), { inviteCode: MOCK_DEMO_INVITE_CODE, nickname: "서연" });

  const sampleAnswers: Record<string, string[]> = {
    "mock-user-minji": [
      "출판사에서 에세이 편집을 하고 있어요.",
      "새벽 수영이요. 물에 들어가면 생각이 정리돼요.",
      "작년에 혼자 하프 마라톤을 완주했어요.",
      "약속은 작게 하고 꼭 지키기.",
    ],
    "mock-user-junho": [
      "작은 스타트업에서 백엔드 개발을 해요.",
      "필름 카메라로 동네 골목 찍기.",
      "회사 동료들 사이에서 파스타 맛집으로 통해요.",
      "",
      "보드게임과 클라이밍이요.",
    ],
    "mock-user-seoyeon": ["대학원에서 도시계획을 공부하고 있어요.", "", "", "", "식물 키우기. 지금 화분이 23개예요."],
  };
  for (const [userId, answers] of Object.entries(sampleAnswers)) {
    const editor = engine.getProfileEditor(as(userId), roomId);
    engine.updateProfile(as(userId), roomId, {
      nickname: editor.me.nickname,
      questions: editor.questions.map((q, i) => ({
        id: q.id,
        answer: answers[i] ?? "",
        tokenCost: i === 2 ? 3 : q.tokenCost,
        isEnabled: true,
      })),
    });
  }
  return db;
}

const globalForMock = globalThis as unknown as { __dokdaeMockDb?: MockDb };

export function getMockDb(): MockDb {
  globalForMock.__dokdaeMockDb ??= seed();
  return globalForMock.__dokdaeMockDb;
}

export function resetMockDb() {
  globalForMock.__dokdaeMockDb = seed();
}
