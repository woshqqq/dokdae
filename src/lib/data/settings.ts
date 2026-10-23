import { z } from "zod";
import type { RoomSettings } from "./types";

/** 모임 최초 생성 시에만 쓰는 기본값. 이후 값은 모임 설정에 저장되고 운영자가 수정한다. */
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  initialTokens: 10,
  defaultQuestionCost: 1,
  minQuestionCost: 0,
  maxQuestionCost: 5,
  giftsEnabled: true,
  giftDefaultAmount: 1,
  giftMinAmount: 1,
  giftMaxAmount: 5,
  customQuestionsEnabled: true,
  maxActiveSessionsPerMember: 1,
  requestExpiryMinutes: 30,
  sessionRetentionDays: 0,
  roomRetentionDays: 0,
  memberListVisible: true,
};

/** 모임 생성 시 함께 만드는 예시 질문 템플릿. 운영자가 언제든 바꿀 수 있다. */
export const DEFAULT_QUESTION_LABELS = [
  "어떤 일을 하고 있나요?",
  "요즘 가장 몰입하는 것은 무엇인가요?",
  "남에게 말하기는 쑥스럽지만 자랑하고 싶은 것은 무엇인가요?",
  "중요하게 생각하는 가치관은 무엇인가요?",
  "요즘 좋아하는 취미나 관심사는 무엇인가요?",
];

const count = (label: string, max: number) =>
  z
    .number({ error: `${label}을(를) 숫자로 입력해 주세요.` })
    .int({ error: `${label}은(는) 정수여야 합니다.` })
    .min(0, { error: `${label}은(는) 0 이상이어야 합니다.` })
    .max(max, { error: `${label}은(는) ${max} 이하여야 합니다.` });

export const roomSettingsSchema = z
  .object({
    initialTokens: count("초기 토큰", 1000),
    defaultQuestionCost: count("기본 열람 비용", 100),
    minQuestionCost: count("최소 열람 비용", 100),
    maxQuestionCost: count("최대 열람 비용", 100),
    giftsEnabled: z.boolean(),
    giftDefaultAmount: count("기본 선물 수량", 100).min(1, { error: "기본 선물 수량은 1 이상이어야 합니다." }),
    giftMinAmount: count("최소 선물 수량", 100).min(1, { error: "최소 선물 수량은 1 이상이어야 합니다." }),
    giftMaxAmount: count("최대 선물 수량", 100).min(1, { error: "최대 선물 수량은 1 이상이어야 합니다." }),
    customQuestionsEnabled: z.boolean(),
    maxActiveSessionsPerMember: count("동시 독대 수", 20).min(1, { error: "동시 독대 수는 1 이상이어야 합니다." }),
    requestExpiryMinutes: count("요청 만료 시간", 10080).min(1, { error: "요청 만료 시간은 1분 이상이어야 합니다." }),
    sessionRetentionDays: count("독대 기록 보관 일수", 365),
    roomRetentionDays: count("모임 데이터 보관 일수", 365),
    memberListVisible: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (s.minQuestionCost > s.maxQuestionCost) {
      ctx.addIssue({ code: "custom", path: ["maxQuestionCost"], message: "최대 열람 비용은 최소 비용 이상이어야 합니다." });
    }
    if (s.defaultQuestionCost < s.minQuestionCost || s.defaultQuestionCost > s.maxQuestionCost) {
      ctx.addIssue({ code: "custom", path: ["defaultQuestionCost"], message: "기본 열람 비용은 최소~최대 범위 안이어야 합니다." });
    }
    if (s.giftMinAmount > s.giftMaxAmount) {
      ctx.addIssue({ code: "custom", path: ["giftMaxAmount"], message: "최대 선물 수량은 최소 수량 이상이어야 합니다." });
    }
    if (s.giftDefaultAmount < s.giftMinAmount || s.giftDefaultAmount > s.giftMaxAmount) {
      ctx.addIssue({ code: "custom", path: ["giftDefaultAmount"], message: "기본 선물 수량은 최소~최대 범위 안이어야 합니다." });
    }
  });

export function isCostInRange(cost: number, s: Pick<RoomSettings, "minQuestionCost" | "maxQuestionCost">) {
  return Number.isInteger(cost) && cost >= s.minQuestionCost && cost <= s.maxQuestionCost;
}

export function clampCost(cost: number, s: Pick<RoomSettings, "minQuestionCost" | "maxQuestionCost">) {
  return Math.min(s.maxQuestionCost, Math.max(s.minQuestionCost, Math.round(cost)));
}
