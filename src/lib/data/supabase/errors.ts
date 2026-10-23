import { DataError, ERROR_MESSAGES, type DataErrorCode } from "../errors";

/** PostgREST 오류의 필요한 부분 */
export interface RpcErrorLike {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

const isKnownCode = (value: string): value is DataErrorCode => Object.hasOwn(ERROR_MESSAGES, value);

/**
 * DB 함수가 던진 오류를 앱 오류로 바꾼다.
 * RPC는 message에 앱 오류 코드, details에 사용자용 문구를 담는다(supabase/migrations/*_functions.sql).
 * 알 수 없는 오류는 null을 돌려 호출자가 일반 오류로 처리하게 한다(내부 메시지를 화면에 노출하지 않음).
 */
export function toDataError(error: RpcErrorLike): DataError | null {
  if (isKnownCode(error.message)) return new DataError(error.message, error.details || undefined);
  switch (error.code) {
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22023": // invalid_parameter_value
      return new DataError("VALIDATION");
    case "22P02": // invalid_text_representation (잘못된 UUID 등)
      return new DataError("NOT_FOUND");
    case "42501": // insufficient_privilege
      return new DataError("FORBIDDEN");
    case "PGRST301": // JWT 만료·검증 실패
    case "PGRST303":
      return new DataError("UNAUTHENTICATED");
    case "PGRST202": // 함수를 찾을 수 없음(마이그레이션 미적용)
    case "42883":
    case "42P01":
      return new DataError("BACKEND_NOT_READY");
    default:
      return null;
  }
}
