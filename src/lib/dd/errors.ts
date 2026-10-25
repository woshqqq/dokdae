export const DD_ERROR_MESSAGES = {
  UNAUTHENTICATED: "이 방에 입장한 기기에서만 사용할 수 있어요. 초대 코드로 다시 입장해 주세요.",
  NOT_FOUND: "요청한 정보를 찾을 수 없어요.",
  VALIDATION: "입력값을 다시 확인해 주세요.",
  INVALID_CODE: "초대 코드가 올바르지 않아요.",
  NICKNAME_TAKEN: "이미 이 방에서 쓰고 있는 닉네임이에요. 다른 닉네임을 써 주세요.",
  MIN_QUESTIONS: "질문이 부족해요. 기본 질문을 포함해 최소 개수 이상을 구성해야 해요.",
  TOO_MANY_QUESTIONS: "개인 질문은 최대 30개까지 추가할 수 있어요.",
  NOT_READY: "먼저 내 질문 구성을 마쳐 주세요.",
  PEER_NOT_READY: "상대가 아직 질문 구성을 마치지 않았어요.",
  PAIR_EXISTS: "이미 이 상대와 진행 중인 독대가 있어요.",
  INVALID_STATE: "지금 상태에서는 할 수 없는 작업이에요. 화면을 새로고침해 주세요.",
  BUSY: "이미 진행 중인 독대가 있어요. 먼저 끝내 주세요.",
  RATE_LIMITED: "시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
  PHOTO_INVALID: "JPG, PNG, WebP 이미지(1MB 이하)만 올릴 수 있어요.",
  ITEM_LIMIT: "항목은 최대 개수까지만 등록할 수 있어요. 기존 항목을 삭제한 뒤 추가해 주세요.",
  ITEM_LOCKED: "이미 열람된 항목은 내용을 바꿀 수 없어요. 삭제하고 새 항목으로 등록해 주세요.",
  INSUFFICIENT_BALANCE: "토큰이 부족해요.",
  PRICE_CHANGED: "항목의 열람 비용이 바뀌었어요. 화면을 새로고침해 비용을 확인해 주세요.",
  REWARD_DONE: "이미 보상을 확정한 항목이에요.",
  REWARD_NOT_SELECTED: "보상 수량을 먼저 선택해 주세요.",
  REWARD_CHANGED: "선택한 보상 수량이 바뀌었어요. 화면을 새로고침해 다시 확인해 주세요.",
  NOT_CONFIGURED: "서버 설정이 완료되지 않았어요. 운영자에게 문의해 주세요.",
  BACKEND_NOT_READY: "서버 데이터베이스가 아직 준비되지 않았어요. 마이그레이션 적용 여부를 확인해 주세요.",
  INTERNAL: "알 수 없는 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
} as const;

export type DdErrorCode = keyof typeof DD_ERROR_MESSAGES;

export class DdError extends Error {
  constructor(
    public readonly code: DdErrorCode,
    message?: string,
  ) {
    super(message ?? DD_ERROR_MESSAGES[code]);
    this.name = "DdError";
  }
}

const isKnown = (value: string): value is DdErrorCode => Object.hasOwn(DD_ERROR_MESSAGES, value);

/** DB 함수가 던진 오류(message 에 코드)를 앱 오류로 바꾼다. 알 수 없는 오류의 내부 메시지는 노출하지 않는다. */
export function fromRpcError(error: { message: string; code?: string }): DdError {
  if (isKnown(error.message)) return new DdError(error.message);
  switch (error.code) {
    case "23514":
    case "23502":
    case "22001":
      return new DdError("VALIDATION");
    case "22P02":
      return new DdError("NOT_FOUND");
    case "PGRST202":
    case "42883":
    case "42P01":
      return new DdError("BACKEND_NOT_READY");
    default:
      console.error("dd rpc failed", error.code, error.message);
      return new DdError("INTERNAL");
  }
}
