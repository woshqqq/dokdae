import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

// Supabase Auth 오류를 사용자 문구와 서버 로그용 진단 정보로 나눈다.
// 사용자에게는 원인을 짐작할 수 있지만 내부 구성은 드러내지 않는 문구만 보여 주고,
// 로그에는 오류 코드·HTTP 상태·메시지를 남긴다(이메일 주소는 가리고, 비밀번호·토큰·키는 다루지 않는다).

export const GENERIC_AUTH_ERROR = "인증 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "이메일 또는 비밀번호가 올바르지 않습니다.",
  email_not_confirmed: "이메일 인증을 먼저 완료해 주세요. 받은 메일의 링크를 눌러 주세요.",
  user_already_exists: "이미 가입된 이메일입니다. 로그인해 주세요.",
  email_exists: "이미 가입된 이메일입니다. 로그인해 주세요.",
  weak_password: "비밀번호가 너무 단순합니다. 더 길거나 복잡하게 만들어 주세요.",
  over_email_send_rate_limit: "메일 발송 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.",
  over_request_rate_limit: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  signup_disabled: "현재 회원가입을 받지 않습니다.",
  email_provider_disabled: "현재 이메일 가입·로그인을 받지 않습니다.",
  email_address_invalid: "사용할 수 없는 이메일 주소입니다. 다른 주소로 시도해 주세요.",
  email_address_not_authorized: "이 이메일 주소로는 인증 메일을 보낼 수 없습니다. 운영자에게 문의해 주세요.",
  validation_failed: "입력값을 확인해 주세요.",
  captcha_failed: "보안 확인에 실패했습니다. 다시 시도해 주세요.",
  request_timeout: "인증 서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.",
  user_banned: "이 계정은 현재 사용할 수 없습니다.",
};

const NETWORK_ERROR = "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";

export type AuthErrorLog = {
  name: string;
  code?: string;
  status?: number;
  message: string;
};

/** 오류 메시지에 섞여 오는 이메일 주소(예: email_address_invalid)를 가리고 길이를 제한한다. */
export function redactAuthMessage(message: string) {
  return message.replace(/[^\s"'<>(),;:@]+@[^\s"'<>(),;:]+/g, "[email]").slice(0, 300);
}

export function describeAuthError(error: unknown): { userMessage: string; log: AuthErrorLog } {
  if (isAuthError(error)) {
    const log: AuthErrorLog = {
      name: error.name,
      code: error.code,
      status: error.status,
      message: redactAuthMessage(error.message),
    };
    const known = error.code ? AUTH_ERROR_MESSAGES[error.code] : undefined;
    if (known) return { userMessage: known, log };
    // 코드 없이 오는 경우: 네트워크 실패·잘못된 Supabase URL(Retryable) 또는 429.
    if (isAuthRetryableFetchError(error)) return { userMessage: NETWORK_ERROR, log };
    if (error.status === 429) return { userMessage: AUTH_ERROR_MESSAGES.over_request_rate_limit, log };
    return { userMessage: GENERIC_AUTH_ERROR, log };
  }
  const e = error instanceof Error ? error : new Error(String(error));
  return { userMessage: GENERIC_AUTH_ERROR, log: { name: e.name, message: redactAuthMessage(e.message) } };
}

/** 오류를 서버 로그에 남기고 사용자 문구를 돌려준다. */
export function reportAuthError(operation: string, error: unknown, extra?: Record<string, string>) {
  const { userMessage, log } = describeAuthError(error);
  console.error(`[auth] ${operation} failed`, { ...log, ...extra });
  return userMessage;
}

/**
 * 인증 메일 링크의 기준 주소. NEXT_PUBLIC_SITE_URL이 올바른 http(s) 주소면 그 origin을,
 * 아니면(값 누락·프로토콜 누락 등) 요청 호스트를 쓴다. 설정 오류는 로그로 알린다.
 */
export function resolveSiteOrigin(configured: string | undefined, fallback: () => string) {
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // 아래에서 경고 후 요청 호스트로 대체한다.
    }
    console.warn("[auth] NEXT_PUBLIC_SITE_URL is not a valid http(s) URL; falling back to request host");
  }
  return fallback();
}
