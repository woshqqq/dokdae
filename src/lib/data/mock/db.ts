import type {
  PairSession,
  QuestionMeta,
  QuestionTemplate,
  Room,
  RoomMember,
  RoomSettings,
  TokenTransaction,
} from "../types";

// 임시(mock) 데이터 저장소의 "테이블". 실제 DB 스키마와 같은 분리 원칙을 따른다:
// 질문 메타데이터(questions)와 답변 원문(answers)은 별도 테이블이다.

export interface MockUser {
  id: string;
  displayName: string;
}

export type MockRoom = Room & { inviteCodeHash: string };
export type MockQuestion = Omit<QuestionMeta, "hasAnswer">;

export interface MockAnswer {
  questionId: string;
  ownerId: string;
  answer: string;
  updatedAt: string;
}

export interface MockWallet {
  roomId: string;
  userId: string;
  balance: number;
  updatedAt: string;
}

export interface MockUnlock {
  id: string;
  sessionId: string;
  roomId: string;
  questionId: string;
  viewerId: string;
  ownerId: string;
  tokensPaid: number;
  createdAt: string;
}

export type MockTransaction = TokenTransaction & { idempotencyKey: string | null };

export interface MockDb {
  users: MockUser[];
  rooms: MockRoom[];
  settings: Record<string, RoomSettings>;
  members: RoomMember[];
  templates: QuestionTemplate[];
  questions: MockQuestion[];
  answers: MockAnswer[];
  wallets: MockWallet[];
  sessions: PairSession[];
  unlocks: MockUnlock[];
  transactions: MockTransaction[];
}

export function emptyDb(): MockDb {
  return {
    users: [],
    rooms: [],
    settings: {},
    members: [],
    templates: [],
    questions: [],
    answers: [],
    wallets: [],
    sessions: [],
    unlocks: [],
    transactions: [],
  };
}
