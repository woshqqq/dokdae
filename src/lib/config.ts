export type DataSource = "mock" | "supabase";

/**
 * 서버에서 사용할 데이터 소스. DOKDAE_DATA_SOURCE 로 지정한다.
 * - mock: 서버 메모리의 임시 데이터. 실제 인증·저장·정산이 아니다.
 * - supabase: 실제 Supabase Auth/DB
 * 값이 없으면 개발 서버에서는 mock, 프로덕션에서는 supabase를 쓴다
 * (설정 누락으로 실서비스에 데모 로그인이 열리지 않게 하기 위함).
 */
export function getDataSource(): DataSource {
  const value = process.env.DOKDAE_DATA_SOURCE;
  if (value === "supabase" || value === "mock") return value;
  return process.env.NODE_ENV === "production" ? "supabase" : "mock";
}
