"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { parseInput, runAction } from "@/lib/action-result";
import { getRepository } from "@/lib/data";

const nickname = z.string().trim().min(1, { error: "닉네임을 입력해 주세요." }).max(20, { error: "닉네임은 20자 이하로 입력해 주세요." });

const createRoomSchema = z.object({
  name: z.string().trim().min(1, { error: "모임 이름을 입력해 주세요." }).max(40, { error: "모임 이름은 40자 이하로 입력해 주세요." }),
  description: z.string().trim().max(200, { error: "설명은 200자 이하로 입력해 주세요." }),
  nickname,
});

export async function createRoomAction(input: z.input<typeof createRoomSchema>) {
  return runAction(async () => {
    const data = parseInput(createRoomSchema, input);
    return (await getRepository()).createRoom(data);
  }, "모임을 만들었습니다.");
}

const joinRoomSchema = z.object({
  inviteCode: z.string().trim().min(4, { error: "모임 코드를 입력해 주세요." }).max(20, { error: "모임 코드가 올바르지 않습니다." }),
  nickname,
});

export async function joinRoomAction(input: z.input<typeof joinRoomSchema>) {
  return runAction(async () => {
    const data = parseInput(joinRoomSchema, input);
    const result = await (await getRepository()).joinRoom(data);
    refresh();
    return result;
  });
}
