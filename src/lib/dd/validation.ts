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

export const itemKindSchema = z.enum(["tell", "ask"], { message: "항목 유형을 선택해 주세요." });
export const itemBodySchema = text("항목 내용", 1, 500);
// 허용 범위(1~3, 보상 0~5)는 DB의 dd_settings 가 최종 판단한다. 여기서는 형식만 거른다.
export const costSchema = z.number().int("비용은 정수여야 해요.").min(1).max(100);
export const rewardAmountSchema = z.number().int("보상은 정수여야 해요.").min(0).max(100);
export const itemTitleSchema = text("항목 제목", 1, 60);
export const itemInputSchema = z.object({ kind: itemKindSchema, title: itemTitleSchema, body: itemBodySchema, cost: costSchema });
/** 기본 항목(기본 질문 슬롯): 제목·질문 문구는 관리자가 정하고, 참가자는 내용과 비용만 쓴다. 유형은 항상 tell. */
export const defaultItemInputSchema = z.object({ body: itemBodySchema, cost: costSchema });
