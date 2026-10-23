// 데이터 계층 공통 오류. Supabase RPC에서도 같은 코드를 예외 메시지로 던지게 해
// 화면의 오류 처리를 데이터 소스와 무관하게 유지한다.

export const ERROR_MESSAGES = {
  UNAUTHENTICATED: "로그인이 필요합니다.",
  NOT_MEMBER: "이 모임의 참여자만 볼 수 있습니다.",
  FORBIDDEN: "이 작업을 할 권한이 없습니다.",
  NOT_FOUND: "요청한 정보를 찾을 수 없습니다.",
  INVALID_INVITE_CODE: "모임 코드가 올바르지 않습니다.",
  ROOM_CLOSED: "종료된 모임입니다.",
  ALREADY_MEMBER: "이미 참여 중인 모임입니다.",
  VALIDATION: "입력값을 다시 확인해 주세요.",
  INSUFFICIENT_BALANCE: "토큰이 부족합니다.",
  SELF_ACTION: "본인에게는 할 수 없는 작업입니다.",
  SESSION_NOT_ACTIVE: "진행 중인 독대가 아닙니다.",
  SESSION_ENDING: "종료 요청이 진행 중이라 토큰 거래를 할 수 없습니다.",
  SESSION_LIMIT: "동시에 진행할 수 있는 독대 수를 초과했습니다.",
  SESSION_DUPLICATE: "이미 이 상대와 대기 중이거나 진행 중인 독대가 있습니다.",
  SESSION_EXPIRED: "만료된 독대 요청입니다.",
  INVALID_STATE: "현재 상태에서는 할 수 없는 작업입니다.",
  QUESTION_UNAVAILABLE: "열 수 없는 질문입니다.",
  PRICE_CHANGED: "질문 비용이 바뀌었어요. 새 비용을 확인하고 다시 시도해 주세요.",
  GIFTS_DISABLED: "이 모임에서는 토큰 보내기를 사용하지 않습니다.",
  CUSTOM_QUESTIONS_DISABLED: "이 모임에서는 직접 질문을 추가할 수 없습니다.",
  NOT_IMPLEMENTED: "아직 연결되지 않은 기능입니다.",
  BACKEND_NOT_READY: "서버 데이터베이스가 아직 준비되지 않았습니다. 마이그레이션 적용 여부를 확인해 주세요.",
} as const;

export type DataErrorCode = keyof typeof ERROR_MESSAGES;

export class DataError extends Error {
  constructor(
    public readonly code: DataErrorCode,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "DataError";
  }
}

export function isDataError(error: unknown): error is DataError {
  return error instanceof DataError;
}

export function toUserMessage(error: unknown): string {
  if (isDataError(error)) return error.message;
  return "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}
