"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { parseInput, runAction } from "@/lib/action-result";
import { getRepository } from "@/lib/data";

const id = z.string().min(1).max(100);
const cost = z.number({ error: "비용은 숫자로 입력해 주세요." }).int({ error: "비용은 정수여야 합니다." }).min(0).max(100);

const updateProfileSchema = z.object({
  roomId: id,
  nickname: z.string().trim().min(1, { error: "닉네임을 입력해 주세요." }).max(20, { error: "닉네임은 20자 이하로 입력해 주세요." }),
  questions: z
    .array(
      z.object({
        id,
        answer: z.string().max(1000, { error: "답변은 1000자 이하로 입력해 주세요." }),
        tokenCost: cost,
        isEnabled: z.boolean(),
      }),
    )
    .max(50),
});

export async function updateProfileAction(input: z.input<typeof updateProfileSchema>) {
  return runAction(async () => {
    const { roomId, ...data } = parseInput(updateProfileSchema, input);
    await (await getRepository()).updateProfile(roomId, data);
    refresh();
    return null;
  }, "프로필을 저장했습니다.");
}

const addCustomSchema = z.object({
  roomId: id,
  label: z.string().trim().min(1, { error: "질문을 입력해 주세요." }).max(100, { error: "질문은 100자 이하로 입력해 주세요." }),
  tokenCost: cost,
});

export async function addCustomQuestionAction(input: z.input<typeof addCustomSchema>) {
  return runAction(async () => {
    const { roomId, ...data } = parseInput(addCustomSchema, input);
    const result = await (await getRepository()).addCustomQuestion(roomId, data);
    refresh();
    return result;
  }, "질문을 추가했습니다.");
}

export async function deleteCustomQuestionAction(roomId: string, questionId: string) {
  return runAction(async () => {
    const data = parseInput(z.object({ roomId: id, questionId: id }), { roomId, questionId });
    await (await getRepository()).deleteCustomQuestion(data.roomId, data.questionId);
    refresh();
    return null;
  }, "질문을 삭제했습니다.");
}
