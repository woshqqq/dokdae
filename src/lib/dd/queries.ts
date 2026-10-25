import "server-only";
import { viewerRpc } from "./db";
import type { Viewer } from "./session";

export type PairStatus = "requested" | "reviewing" | "active" | "closed" | "declined";
export type Direction = "outgoing" | "incoming";

export interface Overview {
  room: { id: string; name: string; invite_code: string | null };
  me: { id: string; nickname: string; bio: string; has_photo: boolean; is_creator: boolean; ready: boolean };
  question_count: number;
  min_questions: number;
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
