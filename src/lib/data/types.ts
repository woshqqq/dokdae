// 독대 도메인 타입. 데이터 소스(mock / Supabase)와 무관하게 화면이 사용하는 형태다.
// 테이블 구조는 CLAUDE.md 10장의 데이터 모델을 따른다.

export type RoomStatus = "active" | "closed";
export type MemberRole = "owner" | "participant";
export type SessionStatus =
  | "pending"
  | "active"
  | "rejected"
  | "cancelled"
  | "expired"
  | "closed";
export type TransactionType =
  | "initial_grant"
  | "unlock_payment"
  | "gift"
  | "admin_adjustment";

export interface RoomSettings {
  initialTokens: number;
  defaultQuestionCost: number;
  minQuestionCost: number;
  maxQuestionCost: number;
  giftsEnabled: boolean;
  giftDefaultAmount: number;
  giftMinAmount: number;
  giftMaxAmount: number;
  customQuestionsEnabled: boolean;
  maxActiveSessionsPerMember: number;
  requestExpiryMinutes: number;
  /** 0이면 종료 확정 즉시 독대 기록 삭제 */
  sessionRetentionDays: number;
  /** 0이면 모임 종료 즉시 모임 데이터 삭제 */
  roomRetentionDays: number;
  memberListVisible: boolean;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  status: RoomStatus;
  createdAt: string;
  closedAt: string | null;
  purgeAt: string | null;
}

export interface RoomMember {
  roomId: string;
  userId: string;
  role: MemberRole;
  nickname: string;
  joinedAt: string;
}

export interface QuestionTemplate {
  id: string;
  roomId: string;
  label: string;
  description: string;
  defaultCost: number;
  isActive: boolean;
  sortOrder: number;
}

/** 질문 메타데이터. 답변 원문은 절대 포함하지 않는다. */
export interface QuestionMeta {
  id: string;
  roomId: string;
  ownerId: string;
  templateId: string | null;
  label: string;
  tokenCost: number;
  isEnabled: boolean;
  sortOrder: number;
  /** 답변 존재 여부만 노출한다(원문 아님). 미답변 질문은 열 수 없다. */
  hasAnswer: boolean;
}

/** 본인 프로필 편집용: 소유자에게만 답변 원문이 함께 내려간다. */
export interface OwnQuestion extends QuestionMeta {
  answer: string;
}

export interface PairSession {
  id: string;
  roomId: string;
  requesterId: string;
  recipientId: string;
  status: SessionStatus;
  requestedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
  requesterEndAt: string | null;
  recipientEndAt: string | null;
  purgeAt: string | null;
}

export interface TokenTransaction {
  id: string;
  roomId: string;
  sessionId: string | null;
  senderId: string | null;
  recipientId: string;
  amount: number;
  type: TransactionType;
  questionId: string | null;
  createdAt: string;
}

export interface CurrentUser {
  id: string;
  displayName: string;
}

// ---------- 화면용 조회 모델 ----------

export interface MyRoomSummary {
  room: Pick<Room, "id" | "name" | "description" | "status">;
  role: MemberRole;
  nickname: string;
  balance: number;
}

export interface SessionSummary {
  id: string;
  status: SessionStatus;
  partner: Pick<RoomMember, "userId" | "nickname">;
  /** 내가 요청한 쪽인지 */
  isRequester: boolean;
  requestedAt: string;
  expiresAt: string;
  /** 종료 요청이 진행 중인지(누가 먼저 눌렀든) */
  endRequested: boolean;
}

export interface RoomDashboard {
  room: Room;
  settings: RoomSettings;
  me: RoomMember;
  balance: number;
  /** 모임 참여자 목록. 비공개 설정이면 운영자 외에는 null */
  members: RoomMember[] | null;
  incomingRequests: SessionSummary[];
  outgoingRequests: SessionSummary[];
  activeSessions: SessionSummary[];
}

export interface ProfileEditor {
  room: Pick<Room, "id" | "name" | "status">;
  settings: Pick<
    RoomSettings,
    "minQuestionCost" | "maxQuestionCost" | "defaultQuestionCost" | "customQuestionsEnabled"
  >;
  me: RoomMember;
  questions: OwnQuestion[];
}

export interface MemberProfileView {
  room: Pick<Room, "id" | "name" | "status">;
  member: RoomMember;
  isMe: boolean;
  /** 공개(활성 + 답변 있음) 질문의 메타데이터만 */
  questions: QuestionMeta[];
  /** 이 상대와 진행 중이거나 대기 중인 독대 */
  openSession: SessionSummary | null;
  /** 독대 요청 가능 여부와 불가 사유 */
  canRequest: { ok: true } | { ok: false; reason: string };
}

export interface SessionQuestion {
  meta: QuestionMeta;
  unlocked: boolean;
  tokensPaid: number | null;
  /** 이 독대가 active이고 열람 권한이 있을 때만 채워진다 */
  answer: string | null;
}

export type EndVoteState =
  | { kind: "none" }
  | { kind: "requested_by_me"; at: string }
  | { kind: "requested_by_partner"; at: string };

export interface SessionView {
  session: PairSession;
  room: Pick<Room, "id" | "name" | "status">;
  settings: Pick<
    RoomSettings,
    "giftsEnabled" | "giftDefaultAmount" | "giftMinAmount" | "giftMaxAmount" | "sessionRetentionDays"
  >;
  me: RoomMember;
  partner: RoomMember;
  myBalance: number;
  /** 상대가 공개한 질문과 내 열람 상태 */
  partnerQuestions: SessionQuestion[];
  endVote: EndVoteState;
  /** 이 독대 안에서 오간 거래(내가 당사자인 것만) */
  transactions: TokenTransaction[];
}

export interface RoomAdminView {
  room: Room;
  settings: RoomSettings;
  templates: QuestionTemplate[];
  memberCount: number;
}
