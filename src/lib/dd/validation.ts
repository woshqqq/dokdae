import { z } from "zod";

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `${label}을(를) 입력해 주세요.`)
    .max(max, `${label}은(는) ${max}자 이하로 입력해 주세요.`);

export const nicknameSchema = text("닉네임", 1, 20);
export const roomNameSchema = text("방 이름", 1, 60);
export const bioSchema = z.string().trim().max(300, "소개는 300자 이하로 입력해 주세요.");
export const answerSchema = z.string().trim().max(2000, "답변은 2000자 이하로 입력해 주세요.");
export const questionBodySchema = text("질문", 1, 300);
export const idSchema = z.uuid("올바르지 않은 요청이에요.");

export const createRoomSchema = z.object({ name: roomNameSchema, nickname: nicknameSchema });
export const joinRoomSchema = z.object({ inviteCode: z.string().max(40), nickname: nicknameSchema });
export const profileSchema = z.object({ nickname: nicknameSchema, bio: bioSchema });

export const defaultQuestionSchema = z.object({
  id: idSchema,
  title: text("제목", 1, 60),
  body: text("질문 본문", 1, 300),
  hint: z.string().trim().max(300, "설명은 300자 이하로 입력해 주세요."),
  position: z.number().int("순서는 정수여야 해요.").min(0).max(1000),
});
