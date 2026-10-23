import type {
  MemberProfileView,
  MyRoomSummary,
  ProfileEditor,
  QuestionTemplate,
  RoomAdminView,
  RoomDashboard,
  RoomSettings,
  SessionView,
} from "./types";

/**
 * 화면과 데이터 소스 사이의 계약.
 *
 * 구현체는 "현재 로그인한 사용자"에 묶여 생성된다. 메서드는 호출자 ID를 인자로 받지 않으며,
 * 권한·소속·잔액 검증은 전부 구현체(Supabase에서는 RLS와 RPC) 안에서 수행해야 한다.
 * 실패는 DataError(코드)로 던진다.
 */
export interface DokdaeRepository {
  // ----- 모임 -----
  listMyRooms(): Promise<MyRoomSummary[]>;
  createRoom(input: { name: string; description: string; nickname: string }): Promise<{ roomId: string; inviteCode: string }>;
  /** 코드 확인 → 중복 가입 방지 → 지갑 생성 → 초기 토큰 지급을 한 번에 처리한다. */
  joinRoom(input: { inviteCode: string; nickname: string }): Promise<{ roomId: string; alreadyMember: boolean }>;
  getRoomDashboard(roomId: string): Promise<RoomDashboard>;

  // ----- 프로필 -----
  getProfileEditor(roomId: string): Promise<ProfileEditor>;
  updateProfile(
    roomId: string,
    input: {
      nickname: string;
      questions: { id: string; answer: string; tokenCost: number; isEnabled: boolean }[];
    },
  ): Promise<void>;
  addCustomQuestion(roomId: string, input: { label: string; tokenCost: number }): Promise<{ questionId: string }>;
  deleteCustomQuestion(roomId: string, questionId: string): Promise<void>;
  getMemberProfile(roomId: string, memberId: string): Promise<MemberProfileView>;

  // ----- 독대 -----
  requestSession(roomId: string, recipientId: string): Promise<{ sessionId: string }>;
  respondToSession(sessionId: string, accept: boolean): Promise<void>;
  cancelSessionRequest(sessionId: string): Promise<void>;
  getSessionView(sessionId: string): Promise<SessionView>;
  /**
   * 이미 연 질문이면 다시 청구하지 않고 alreadyUnlocked=true를 돌려준다.
   * expectedCost는 사용자가 확인한 비용이며, 현재 비용과 다르면 PRICE_CHANGED로 거절한다.
   */
  unlockQuestion(
    sessionId: string,
    questionId: string,
    expectedCost: number,
  ): Promise<{ alreadyUnlocked: boolean; balance: number }>;
  /** requestId가 같은 재요청은 한 번만 처리된다. */
  sendGift(sessionId: string, input: { amount: number; requestId: string }): Promise<{ duplicate: boolean; balance: number }>;
  /** 종료 동의. 양쪽이 모두 동의하면 closed가 된다. */
  voteEndSession(sessionId: string): Promise<{ closed: boolean; roomId: string }>;
  /** 내 종료 요청 철회 또는 상대 요청 거절(종료 동의를 모두 초기화). */
  cancelEndVote(sessionId: string): Promise<void>;

  // ----- 운영자 -----
  getRoomAdmin(roomId: string): Promise<RoomAdminView>;
  updateRoomInfo(roomId: string, input: { name: string; description: string }): Promise<void>;
  updateRoomSettings(roomId: string, settings: RoomSettings): Promise<void>;
  regenerateInviteCode(roomId: string): Promise<{ inviteCode: string }>;
  upsertQuestionTemplate(
    roomId: string,
    input: Omit<QuestionTemplate, "id" | "roomId" | "sortOrder"> & { id?: string },
  ): Promise<void>;
  deleteQuestionTemplate(roomId: string, templateId: string): Promise<void>;
  moveQuestionTemplate(roomId: string, templateId: string, direction: "up" | "down"): Promise<void>;
  closeRoom(roomId: string): Promise<void>;
}
