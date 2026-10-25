"use server";

import { headers } from "next/headers";
import { ddAction, parse } from "@/lib/dd/action";
import { ddRpc, viewerRpc } from "@/lib/dd/db";
import { DdError } from "@/lib/dd/errors";
import { requireViewer, writeParticipantCookie } from "@/lib/dd/session";
import { generateInviteCode, newParticipantToken, normalizeInviteCode } from "@/lib/dd/token";
import {
  answerSchema,
  createRoomSchema,
  costSchema,
  idSchema,
  itemInputSchema,
  joinRoomSchema,
  profileSchema,
  questionBodySchema,
  rewardAmountSchema,
} from "@/lib/dd/validation";
import { createFailureLimiter } from "@/lib/test-mode/rate-limit";

// 초대 코드 대입 공격을 늦추기 위한 실패 횟수 제한(서버 인스턴스 메모리 기준).
const globalForLimiter = globalThis as unknown as { __ddJoinLimiter?: ReturnType<typeof createFailureLimiter> };
const joinLimiter = (globalForLimiter.__ddJoinLimiter ??= createFailureLimiter(10, 10 * 60 * 1000));

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

type RoomEntry = { room_id: string; participant_id: string };

/** 방을 만들고 방 생성자 참가자로 입장한다. 초대 코드는 방 화면에서 생성자에게만 보인다. */
export async function createRoomAction(input: unknown) {
  return ddAction(async () => {
    const { name, nickname } = parse(createRoomSchema, input);
    const token = newParticipantToken();
    const out = await ddRpc<RoomEntry>("dd_api_create_room", {
      p_name: name,
      p_code: generateInviteCode(),
      p_token: token,
      p_nickname: nickname,
    });
    await writeParticipantCookie(out.room_id, token);
    return { roomId: out.room_id };
  });
}

/** 초대 코드로 새 참가자로 입장한다. 방 코드만으로는 다른 참가자의 비공개 정보를 볼 수 없다. */
export async function joinRoomAction(input: unknown) {
  return ddAction(async () => {
    const { inviteCode, nickname } = parse(joinRoomSchema, input);
    const key = await clientKey();
    const now = Date.now();
    if (joinLimiter.isBlocked(key, now)) throw new DdError("RATE_LIMITED");
    const code = normalizeInviteCode(inviteCode);
    if (!code) {
      joinLimiter.recordFailure(key, now);
      throw new DdError("INVALID_CODE");
    }
    const token = newParticipantToken();
    let out: RoomEntry;
    try {
      out = await ddRpc<RoomEntry>("dd_api_join_room", { p_code: code, p_token: token, p_nickname: nickname });
    } catch (error) {
      if (error instanceof DdError && error.code === "INVALID_CODE") joinLimiter.recordFailure(key, now);
      throw error;
    }
    await writeParticipantCookie(out.room_id, token);
    return { roomId: out.room_id };
  });
}

export async function updateProfileAction(roomId: string, input: unknown) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    const data = parse(profileSchema, input);
    await viewerRpc(viewer, "dd_api_update_profile", { p_nickname: data.nickname, p_bio: data.bio });
    return null;
  });
}

export async function saveAnswerAction(roomId: string, questionId: string, answer: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    await viewerRpc(viewer, "dd_api_save_answer", {
      p_question: parse(idSchema, questionId),
      p_body: parse(answerSchema, answer),
    });
    return null;
  });
}

export async function addQuestionAction(roomId: string, body: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    await viewerRpc(viewer, "dd_api_add_question", { p_body: parse(questionBodySchema, body) });
    return null;
  });
}

export async function updateQuestionAction(roomId: string, questionId: string, body: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    await viewerRpc(viewer, "dd_api_update_question", {
      p_question: parse(idSchema, questionId),
      p_body: parse(questionBodySchema, body),
    });
    return null;
  });
}

export async function deleteQuestionAction(roomId: string, questionId: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    await viewerRpc(viewer, "dd_api_delete_question", { p_question: parse(idSchema, questionId) });
    return null;
  });
}

export async function markReadyAction(roomId: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    await viewerRpc(viewer, "dd_api_mark_ready");
    return null;
  });
}

export async function requestPairAction(roomId: string, peerId: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    const pairId = await viewerRpc<string>(viewer, "dd_api_request_pair", { p_peer: parse(idSchema, peerId) });
    return { pairId };
  });
}

export async function respondPairAction(roomId: string, pairId: string, accept: boolean) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    const status = await viewerRpc<string>(viewer, "dd_api_respond_pair", {
      p_pair: parse(idSchema, pairId),
      p_accept: accept === true,
    });
    return { status };
  });
}

export async function consentPairAction(roomId: string, pairId: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    const status = await viewerRpc<string>(viewer, "dd_api_consent", { p_pair: parse(idSchema, pairId) });
    return { status };
  });
}

export async function endPairAction(roomId: string, pairId: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    const status = await viewerRpc<string>(viewer, "dd_api_end_pair", { p_pair: parse(idSchema, pairId) });
    return { status };
  });
}

export async function addItemAction(roomId: string, input: unknown) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    const item = parse(itemInputSchema, input);
    await viewerRpc(viewer, "dd_api_add_item", { p_kind: item.kind, p_body: item.body, p_cost: item.cost });
    return null;
  });
}

export async function updateItemAction(roomId: string, itemId: string, input: unknown) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    const item = parse(itemInputSchema, input);
    await viewerRpc(viewer, "dd_api_update_item", {
      p_item: parse(idSchema, itemId),
      p_kind: item.kind,
      p_body: item.body,
      p_cost: item.cost,
    });
    return null;
  });
}

export async function deleteItemAction(roomId: string, itemId: string) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    await viewerRpc(viewer, "dd_api_delete_item", { p_item: parse(idSchema, itemId) });
    return null;
  });
}

/** 항목 열람(결제). 화면에서 본 비용(expectedCost)이 현재 비용과 다르면 서버가 거절한다. */
export async function unlockItemAction(roomId: string, pairId: string, itemId: string, expectedCost: number) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    return viewerRpc<{ already_unlocked: boolean; unlock_id: string; balance: number }>(viewer, "dd_api_unlock_item", {
      p_pair: parse(idSchema, pairId),
      p_item: parse(idSchema, itemId),
      p_expected_cost: parse(costSchema, expectedCost),
    });
  });
}

/** 보상 수량 선택(저장만 한다. 실제 이전은 confirmRewardAction). */
export async function setRewardAction(roomId: string, unlockId: string, amount: number) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    await viewerRpc(viewer, "dd_api_set_reward", { p_unlock: parse(idSchema, unlockId), p_amount: parse(rewardAmountSchema, amount) });
    return null;
  });
}

/** 보상 지급 확정(열람 건당 한 번). 독대가 끝난 뒤에도 가능하다. */
export async function confirmRewardAction(roomId: string, unlockId: string, expectedAmount: number) {
  return ddAction(async () => {
    const viewer = await requireViewer(roomId);
    return viewerRpc<{ duplicate: boolean; reward_amount: number; balance: number }>(viewer, "dd_api_confirm_reward", {
      p_unlock: parse(idSchema, unlockId),
      p_expected_amount: parse(rewardAmountSchema, expectedAmount),
    });
  });
}
