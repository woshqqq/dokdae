import { beforeEach, describe, expect, it } from "vitest";
import { DataError } from "../errors";
import { emptyDb, type MockDb } from "./db";
import * as engine from "./engine";

// 임시 엔진의 정산·권한 규칙 테스트. Supabase RPC를 구현하면 같은 시나리오를 DB 테스트로 옮긴다.

const A = "user-a";
const B = "user-b";
const C = "user-c";

let db: MockDb;
let now: Date;
const as = (actorId: string) => ({ db, actorId, now });

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    expect((e as DataError).code).toBe(code);
    return;
  }
  throw new Error(`expected DataError ${code}`);
}

const balanceOf = (roomId: string, userId: string) =>
  db.wallets.find((w) => w.roomId === roomId && w.userId === userId)!.balance;
const totalTokens = (roomId: string) => db.wallets.filter((w) => w.roomId === roomId).reduce((s, w) => s + w.balance, 0);

function setupRoom() {
  const { roomId, inviteCode } = engine.createRoom(as(A), { name: "테스트 모임", description: "", nickname: "에이" });
  engine.joinRoom(as(B), { inviteCode, nickname: "비" });
  // B의 첫 질문에 답변 + 비용 3
  const editor = engine.getProfileEditor(as(B), roomId);
  engine.updateProfile(as(B), roomId, {
    nickname: "비",
    questions: editor.questions.map((q, i) => ({ id: q.id, answer: i === 0 ? "B의 비밀 답변" : "", tokenCost: 3, isEnabled: true })),
  });
  const questionId = editor.questions[0].id;
  const { sessionId } = engine.requestSession(as(A), roomId, B);
  engine.respondToSession(as(B), sessionId, true);
  return { roomId, inviteCode, sessionId, questionId };
}

beforeEach(() => {
  db = emptyDb();
  now = new Date("2026-10-22T10:00:00Z");
});

describe("가입과 초기 토큰", () => {
  it("유효하지 않은 코드로는 가입할 수 없다", () => {
    engine.createRoom(as(A), { name: "모임", description: "", nickname: "에이" });
    expectCode(() => engine.joinRoom(as(B), { inviteCode: "WRONG-CODE", nickname: "비" }), "INVALID_INVITE_CODE");
  });

  it("초기 토큰은 정확히 한 번만 지급된다", () => {
    const { roomId, inviteCode } = engine.createRoom(as(A), { name: "모임", description: "", nickname: "에이" });
    expect(engine.joinRoom(as(B), { inviteCode, nickname: "비" }).alreadyMember).toBe(false);
    expect(engine.joinRoom(as(B), { inviteCode: inviteCode.toLowerCase(), nickname: "비" }).alreadyMember).toBe(true);
    expect(balanceOf(roomId, B)).toBe(10);
    expect(db.transactions.filter((t) => t.recipientId === B && t.type === "initial_grant")).toHaveLength(1);
  });

  it("설정한 초기 토큰 수량이 새 참여자에게 적용된다", () => {
    const { roomId, inviteCode } = engine.createRoom(as(A), { name: "모임", description: "", nickname: "에이" });
    const s = engine.getRoomAdmin(as(A), roomId).settings;
    engine.updateRoomSettings(as(A), roomId, { ...s, initialTokens: 25 });
    engine.joinRoom(as(B), { inviteCode, nickname: "비" });
    expect(balanceOf(roomId, B)).toBe(25);
  });
});

describe("답변 노출", () => {
  it("열기 전에는 상대 답변이 어떤 조회 결과에도 포함되지 않는다", () => {
    const { roomId, sessionId } = setupRoom();
    expect(JSON.stringify(engine.getMemberProfile(as(A), roomId, B))).not.toContain("B의 비밀 답변");
    expect(JSON.stringify(engine.getSessionView(as(A), sessionId))).not.toContain("B의 비밀 답변");
  });

  it("다른 참여자의 프로필 답변은 수정할 수 없다", () => {
    const { roomId, questionId } = setupRoom();
    expectCode(
      () =>
        engine.updateProfile(as(A), roomId, {
          nickname: "에이",
          questions: [{ id: questionId, answer: "덮어쓰기", tokenCost: 1, isEnabled: true }],
        }),
      "FORBIDDEN",
    );
  });
});

describe("질문 열기", () => {
  it("열면 비용만큼 이전되고, 다시 열어도 추가 차감되지 않는다", () => {
    const { roomId, sessionId, questionId } = setupRoom();
    const r1 = engine.unlockQuestion(as(A), sessionId, questionId);
    expect(r1).toEqual({ alreadyUnlocked: false, balance: 7 });
    expect(balanceOf(roomId, B)).toBe(13);
    const r2 = engine.unlockQuestion(as(A), sessionId, questionId);
    expect(r2).toEqual({ alreadyUnlocked: true, balance: 7 });
    expect(balanceOf(roomId, B)).toBe(13);
    expect(totalTokens(roomId)).toBe(20);
    expect(engine.getSessionView(as(A), sessionId).partnerQuestions[0].answer).toBe("B의 비밀 답변");
  });

  it("잔액이 부족하면 거절되고 아무것도 바뀌지 않는다", () => {
    const { roomId, sessionId, questionId } = setupRoom();
    db.wallets.find((w) => w.userId === A)!.balance = 2;
    expectCode(() => engine.unlockQuestion(as(A), sessionId, questionId), "INSUFFICIENT_BALANCE");
    expect(balanceOf(roomId, A)).toBe(2);
    expect(balanceOf(roomId, B)).toBe(10);
    expect(db.unlocks).toHaveLength(0);
  });

  it("자기 답변, 잘못된 ID, 다른 모임의 질문은 거절된다", () => {
    const { sessionId } = setupRoom();
    const myQuestion = db.questions.find((q) => q.ownerId === A)!;
    expectCode(() => engine.unlockQuestion(as(A), sessionId, myQuestion.id), "SELF_ACTION");
    expectCode(() => engine.unlockQuestion(as(A), sessionId, "no-such-question"), "QUESTION_UNAVAILABLE");

    const other = engine.createRoom(as(C), { name: "다른 모임", description: "", nickname: "씨" });
    const foreign = db.questions.find((q) => q.roomId === other.roomId)!;
    expectCode(() => engine.unlockQuestion(as(A), sessionId, foreign.id), "QUESTION_UNAVAILABLE");
  });

  it("당사자가 아닌 사용자는 독대에 접근할 수 없다", () => {
    const { roomId, inviteCode, sessionId, questionId } = setupRoom();
    engine.joinRoom(as(C), { inviteCode, nickname: "씨" });
    expectCode(() => engine.getSessionView(as(C), sessionId), "NOT_FOUND");
    expectCode(() => engine.unlockQuestion(as(C), sessionId, questionId), "NOT_FOUND");
    expect(balanceOf(roomId, C)).toBe(10);
  });

  it("확인한 비용과 현재 비용이 다르면 결제하지 않는다", () => {
    const { roomId, sessionId, questionId } = setupRoom();
    expectCode(() => engine.unlockQuestion(as(A), sessionId, questionId, 1), "PRICE_CHANGED");
    expect(balanceOf(roomId, A)).toBe(10);
    expect(engine.unlockQuestion(as(A), sessionId, questionId, 3).alreadyUnlocked).toBe(false);
  });

  it("비용 변경은 과거 결제에 소급되지 않고 새 열람에만 적용된다", () => {
    const { roomId, sessionId, questionId } = setupRoom();
    engine.unlockQuestion(as(A), sessionId, questionId);
    const q = db.questions.find((x) => x.id === questionId)!;
    q.tokenCost = 5;
    engine.unlockQuestion(as(A), sessionId, questionId);
    expect(balanceOf(roomId, A)).toBe(7);
  });
});

describe("토큰 선물", () => {
  it("같은 양만큼 이전되고, 같은 요청 ID는 한 번만 처리된다", () => {
    const { roomId, sessionId } = setupRoom();
    expect(engine.sendGift(as(A), sessionId, { amount: 2, requestId: "req-12345678" }).duplicate).toBe(false);
    expect(engine.sendGift(as(A), sessionId, { amount: 2, requestId: "req-12345678" }).duplicate).toBe(true);
    expect(balanceOf(roomId, A)).toBe(8);
    expect(balanceOf(roomId, B)).toBe(12);
  });

  it("설정 범위를 벗어나거나 선물이 꺼져 있으면 거절된다", () => {
    const { roomId, sessionId } = setupRoom();
    expectCode(() => engine.sendGift(as(A), sessionId, { amount: 99, requestId: "req-aaaaaaaa" }), "VALIDATION");
    const s = engine.getRoomAdmin(as(A), roomId).settings;
    engine.updateRoomSettings(as(A), roomId, { ...s, giftsEnabled: false });
    expectCode(() => engine.sendGift(as(A), sessionId, { amount: 1, requestId: "req-bbbbbbbb" }), "GIFTS_DISABLED");
  });
});

describe("독대 종료", () => {
  it("한쪽만 종료하면 닫히지 않지만 새 거래는 막힌다", () => {
    const { sessionId, questionId } = setupRoom();
    expect(engine.voteEndSession(as(A), sessionId).closed).toBe(false);
    expect(db.sessions.find((s) => s.id === sessionId)!.status).toBe("active");
    expectCode(() => engine.unlockQuestion(as(A), sessionId, questionId), "SESSION_ENDING");
    expectCode(() => engine.sendGift(as(B), sessionId, { amount: 1, requestId: "req-cccccccc" }), "SESSION_ENDING");
  });

  it("보관 기간이 0이면 양쪽 동의 즉시 독대 기록이 삭제되고 지갑은 유지된다", () => {
    const { roomId, sessionId, questionId } = setupRoom();
    engine.unlockQuestion(as(A), sessionId, questionId);
    engine.voteEndSession(as(A), sessionId);
    expect(engine.voteEndSession(as(B), sessionId).closed).toBe(true);
    expect(db.sessions.find((s) => s.id === sessionId)).toBeUndefined();
    expect(db.unlocks).toHaveLength(0);
    expect(db.transactions.filter((t) => t.sessionId === sessionId)).toHaveLength(0);
    expect(balanceOf(roomId, A)).toBe(7);
  });

  it("보관 중인 종료 독대에서도 답변은 보이지 않고, 새 독대에서는 다시 열어야 한다", () => {
    const { roomId, sessionId, questionId } = setupRoom();
    const s = engine.getRoomAdmin(as(A), roomId).settings;
    engine.updateRoomSettings(as(A), roomId, { ...s, sessionRetentionDays: 7 });
    engine.unlockQuestion(as(A), sessionId, questionId);
    engine.voteEndSession(as(A), sessionId);
    engine.voteEndSession(as(B), sessionId);
    const closed = engine.getSessionView(as(A), sessionId);
    expect(closed.session.status).toBe("closed");
    expect(closed.partnerQuestions[0].answer).toBeNull();

    const { sessionId: next } = engine.requestSession(as(A), roomId, B);
    engine.respondToSession(as(B), next, true);
    expect(engine.getSessionView(as(A), next).partnerQuestions[0].unlocked).toBe(false);

    now = new Date(now.getTime() + 8 * 86_400_000);
    engine.runMaintenance({ db, now });
    expect(db.sessions.find((x) => x.id === sessionId)).toBeUndefined();
  });

  it("같은 두 사람 사이에 중복 독대를 만들 수 없다", () => {
    const { roomId } = setupRoom();
    expectCode(() => engine.requestSession(as(B), roomId, A), "SESSION_DUPLICATE");
  });
});

describe("모임 종료", () => {
  it("종료된 모임에는 새로 참여할 수 없고, 보관 0이면 데이터가 삭제된다", () => {
    const { roomId, inviteCode } = setupRoom();
    engine.closeRoom(as(A), roomId);
    expectCode(() => engine.joinRoom(as(C), { inviteCode, nickname: "씨" }), "INVALID_INVITE_CODE");
    expect(db.rooms).toHaveLength(0);
    expect(db.answers).toHaveLength(0);
    expect(db.wallets).toHaveLength(0);
  });

  it("보관 기간이 있으면 종료 후 참여·독대가 막히고 기간 뒤 삭제된다", () => {
    const { roomId, inviteCode } = setupRoom();
    const s = engine.getRoomAdmin(as(A), roomId).settings;
    engine.updateRoomSettings(as(A), roomId, { ...s, roomRetentionDays: 3 });
    engine.closeRoom(as(A), roomId);
    expectCode(() => engine.joinRoom(as(C), { inviteCode, nickname: "씨" }), "ROOM_CLOSED");
    expectCode(() => engine.requestSession(as(B), roomId, A), "ROOM_CLOSED");
    now = new Date(now.getTime() + 4 * 86_400_000);
    engine.runMaintenance({ db, now });
    engine.runMaintenance({ db, now });
    expect(db.rooms).toHaveLength(0);
  });
});
