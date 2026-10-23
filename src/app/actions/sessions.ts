"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { parseInput, runAction } from "@/lib/action-result";
import { getRepository } from "@/lib/data";

const id = z.string().min(1).max(100);

export async function requestSessionAction(roomId: string, recipientId: string) {
  return runAction(async () => {
    const data = parseInput(z.object({ roomId: id, recipientId: id }), { roomId, recipientId });
    const result = await (await getRepository()).requestSession(data.roomId, data.recipientId);
    refresh();
    return result;
  }, "독대를 요청했습니다. 상대가 수락하면 독대 화면이 열립니다.");
}

export async function respondToSessionAction(sessionId: string, accept: boolean) {
  return runAction(
    async () => {
      const data = parseInput(z.object({ sessionId: id, accept: z.boolean() }), { sessionId, accept });
      await (await getRepository()).respondToSession(data.sessionId, data.accept);
      refresh();
      return null;
    },
    accept ? "독대를 수락했습니다." : "독대 요청을 거절했습니다.",
  );
}

export async function cancelSessionRequestAction(sessionId: string) {
  return runAction(async () => {
    await (await getRepository()).cancelSessionRequest(parseInput(id, sessionId));
    refresh();
    return null;
  }, "독대 요청을 취소했습니다.");
}

export async function unlockQuestionAction(sessionId: string, questionId: string, expectedCost: number) {
  return runAction(async () => {
    const data = parseInput(z.object({ sessionId: id, questionId: id, expectedCost: z.number().int().min(0).max(100) }), {
      sessionId,
      questionId,
      expectedCost,
    });
    const result = await (await getRepository()).unlockQuestion(data.sessionId, data.questionId, data.expectedCost);
    refresh();
    return result;
  });
}

const giftSchema = z.object({
  sessionId: id,
  amount: z.number().int({ error: "수량은 정수여야 합니다." }).min(1, { error: "1개 이상 보내야 합니다." }).max(1000),
  requestId: z.string().min(8).max(100),
});

export async function sendGiftAction(input: z.input<typeof giftSchema>) {
  return runAction(async () => {
    const { sessionId, ...data } = parseInput(giftSchema, input);
    const result = await (await getRepository()).sendGift(sessionId, data);
    refresh();
    return result;
  });
}

export async function voteEndSessionAction(sessionId: string) {
  return runAction(async () => {
    const result = await (await getRepository()).voteEndSession(parseInput(id, sessionId));
    refresh();
    return result;
  });
}

export async function cancelEndVoteAction(sessionId: string) {
  return runAction(async () => {
    await (await getRepository()).cancelEndVote(parseInput(id, sessionId));
    refresh();
    return null;
  }, "독대를 계속합니다.");
}
