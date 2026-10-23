"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { fieldErrorsOf } from "@/lib/zod-errors";
import { getRepository } from "@/lib/data";
import { roomSettingsSchema } from "@/lib/data/settings";
import type { RoomSettings } from "@/lib/data/types";

const id = z.string().min(1).max(100);

const roomInfoSchema = z.object({
  roomId: id,
  name: z.string().trim().min(1, { error: "모임 이름을 입력해 주세요." }).max(40, { error: "모임 이름은 40자 이하로 입력해 주세요." }),
  description: z.string().trim().max(200, { error: "설명은 200자 이하로 입력해 주세요." }),
});

export async function updateRoomInfoAction(input: z.input<typeof roomInfoSchema>) {
  return runAction(async () => {
    const { roomId, ...data } = parseInput(roomInfoSchema, input);
    await (await getRepository()).updateRoomInfo(roomId, data);
    refresh();
    return null;
  }, "모임 정보를 저장했습니다.");
}

export async function updateRoomSettingsAction(roomId: string, settings: RoomSettings): Promise<ActionResult> {
  const parsed = roomSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    return { ok: false, error: "입력값을 다시 확인해 주세요.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  return runAction(async () => {
    await (await getRepository()).updateRoomSettings(parseInput(id, roomId), parsed.data);
    refresh();
    return null;
  }, "설정을 저장했습니다. 이후 동작부터 반영됩니다.");
}

export async function regenerateInviteCodeAction(roomId: string) {
  return runAction(async () => (await getRepository()).regenerateInviteCode(parseInput(id, roomId)));
}

const templateSchema = z.object({
  roomId: id,
  id: id.optional(),
  label: z.string().trim().min(1, { error: "질문을 입력해 주세요." }).max(100, { error: "질문은 100자 이하로 입력해 주세요." }),
  description: z.string().trim().max(200, { error: "설명은 200자 이하로 입력해 주세요." }),
  defaultCost: z.number({ error: "비용은 숫자로 입력해 주세요." }).int().min(0).max(100),
  isActive: z.boolean(),
});

export async function upsertQuestionTemplateAction(input: z.input<typeof templateSchema>) {
  return runAction(async () => {
    const { roomId, ...data } = parseInput(templateSchema, input);
    await (await getRepository()).upsertQuestionTemplate(roomId, data);
    refresh();
    return null;
  }, "질문 목록을 저장했습니다.");
}

export async function deleteQuestionTemplateAction(roomId: string, templateId: string) {
  return runAction(async () => {
    const data = parseInput(z.object({ roomId: id, templateId: id }), { roomId, templateId });
    await (await getRepository()).deleteQuestionTemplate(data.roomId, data.templateId);
    refresh();
    return null;
  }, "질문을 삭제했습니다.");
}

export async function moveQuestionTemplateAction(roomId: string, templateId: string, direction: "up" | "down") {
  return runAction(async () => {
    const data = parseInput(z.object({ roomId: id, templateId: id, direction: z.enum(["up", "down"]) }), {
      roomId,
      templateId,
      direction,
    });
    await (await getRepository()).moveQuestionTemplate(data.roomId, data.templateId, data.direction);
    refresh();
    return null;
  });
}

export async function closeRoomAction(roomId: string) {
  return runAction(async () => {
    await (await getRepository()).closeRoom(parseInput(id, roomId));
    refresh();
    return null;
  }, "모임을 종료했습니다.");
}
