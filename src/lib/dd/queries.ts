import "server-only";
import { ddRpc, viewerRpc } from "./db";
import type { Viewer } from "./session";

export type PairStatus = "requested" | "reviewing" | "active" | "closed" | "declined";
export type Direction = "outgoing" | "incoming";

export interface Overview {
  room: { id: string; name: string; invite_code: string | null };
  me: { id: string; nickname: string; bio: string; has_photo: boolean; is_creator: boolean; ready: boolean };
  question_count: number;
  min_questions: number;
  /** 내 토큰 잔액 */
  balance: number;
  items_count: number;
  members: {
    id: string;
    nickname: string;
    has_photo: boolean;
    ready: boolean;
    is_creator: boolean;
    pair: { id: string; status: PairStatus; direction: Direction } | null;
  }[];
  pairs: {
    id: string;
    status: PairStatus;
    direction: Direction;
    peer_id: string;
    peer_nickname: string;
    requested_at: string;
    closed_at: string | null;
  }[];
}

export interface MyQuestions {
  min_questions: number;
  total: number;
  ready: boolean;
  questions: { id: string; kind: "default" | "personal"; title: string; body: string; hint: string; answer: string | null }[];
}

export interface PairView {
  pair: {
    id: string;
    status: PairStatus;
    direction: Direction;
    my_consent: boolean;
    peer_consent: boolean;
    requested_at: string;
    started_at: string | null;
    closed_at: string | null;
  };
  peer: {
    id: string;
    nickname: string;
    has_photo: boolean;
    /** reviewing/active 일 때만 값이 있다 */
    bio: string | null;
    answers: { id: string; kind: "default" | "personal"; title: string; body: string; answer: string | null }[] | null;
  };
}

export const getOverview = (viewer: Viewer) => viewerRpc<Overview>(viewer, "dd_api_overview");
export const getMyQuestions = (viewer: Viewer) => viewerRpc<MyQuestions>(viewer, "dd_api_my_questions");
export const getPairView = (viewer: Viewer, pairId: string) =>
  viewerRpc<PairView>(viewer, "dd_api_view_pair", { p_pair: pairId });

/** 기본 질문의 표시 번호(01, 02…). 관리자가 순서를 바꾸면 번호도 따라간다. */
export function defaultNumbers<T extends { id: string; kind: string }>(items: T[]) {
  const numbers = new Map<string, string>();
  let n = 0;
  for (const item of items) if (item.kind === "default") numbers.set(item.id, String(++n).padStart(2, "0"));
  return numbers;
}

export type ItemKind = "tell" | "ask";

export interface OwnerOpen {
  unlock_id: string;
  viewer_nickname: string;
  opened_at: string;
  tokens_paid: number;
  reward_confirmed: boolean;
  /** 확정된 보상만 보인다(열람자의 미확정 선택값은 숨김) */
  reward_amount: number | null;
}

export interface MyItems {
  max_items: number;
  cost_min: number;
  cost_max: number;
  reward_max: number;
  items: { id: string; kind: ItemKind; body: string; cost: number; opens: OwnerOpen[] }[];
  removed_opens: OwnerOpen[];
}

export interface PeerItems {
  balance: number;
  reward_max: number;
  /** active 독대에서만 채워진다. 열람 전 정보는 순번과 비용뿐이다. */
  items: { id: string; ordinal: number; cost: number; unlocked: boolean }[];
  opened: {
    unlock_id: string;
    /** 독대가 active 일 때만 값이 있다(열람 당시 내용) */
    kind: ItemKind | null;
    body: string | null;
    item_deleted: boolean;
    tokens_paid: number;
    opened_at: string;
    reward_selected: number | null;
    reward_amount: number | null;
    reward_confirmed: boolean;
  }[];
}

export interface Transaction {
  type: "initial_grant" | "unlock_payment" | "reward";
  amount: number;
  created_at: string;
  direction: "in" | "out";
  counterpart: string | null;
}

export const getMyItems = (viewer: Viewer) => viewerRpc<MyItems>(viewer, "dd_api_my_items");
export const getPeerItems = (viewer: Viewer, pairId: string) => viewerRpc<PeerItems>(viewer, "dd_api_peer_items", { p_pair: pairId });
export const getMyTransactions = (viewer: Viewer) => viewerRpc<Transaction[]>(viewer, "dd_api_my_transactions");

export interface DefaultQuestion {
  id: string;
  title: string;
  body: string;
  hint: string;
  position: number;
}

/** 관리자가 편집하는 기본 질문. 항목 작성 화면의 "이런 질문으로 시작해 보세요"에만 쓰고 항목 본문에는 저장하지 않는다. */
export const getDefaultQuestions = () => ddRpc<DefaultQuestion[]>("dd_api_default_questions");
