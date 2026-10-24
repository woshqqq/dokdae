# 독대

같은 모임 사람과 1:1로 대화할 때 쓰는 모바일 우선 웹앱입니다. 개발 명세는 [CLAUDE.md](CLAUDE.md)를 참고하세요.

> **현재 상태: Supabase 연동 1차 구현 — 원격 DB 미적용**
> 마이그레이션(스키마·RLS·RPC)과 앱 연결 코드는 작성되어 있고, SQL은 로컬 테스트(PGlite)로 검증했습니다.
> 아직 **원격 Supabase 프로젝트에는 적용하지 않았으므로**, supabase 모드에서 로그인 후 화면은 마이그레이션을 적용하기 전까지 동작하지 않습니다.
> 개발용 mock 모드(서버 메모리 임시 데이터)는 그대로 사용할 수 있습니다.

## 실행

Node.js 20.9 이상(개발 환경: Node 24 LTS)이 필요합니다.

```bash
npm install
cp .env.example .env.local   # Windows PowerShell: Copy-Item .env.example .env.local
npm run dev                  # http://localhost:3000
```

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 프로덕션 빌드 / 실행 |
| `npm run typecheck` | 라우트 타입 생성 + TypeScript 검사 |
| `npm run lint` | ESLint |
| `npm test` | 단위 테스트 + DB 테스트(마이그레이션을 PGlite에 적용해 RLS·RPC 검증) |

### 데이터 소스 (`DOKDAE_DATA_SOURCE`)

- `mock`: 서버 메모리 임시 데이터와 데모 사용자 선택. 화면 상단에 "임시 데이터 모드" 배너가 표시됩니다.
- `supabase`: 이메일·비밀번호 회원가입/로그인, 모든 데이터는 Supabase DB.
- 비워 두면 개발 서버는 mock, 프로덕션 빌드는 supabase입니다(설정 누락으로 실서비스에 데모 로그인이 열리지 않도록).
- supabase 모드에서는 데모 로그인 액션이 거부되고, mock 쿠키를 넣어도 로그인되지 않습니다.

### 비회원 테스트 모드 (`/test-login`)

회원가입·이메일 인증 없이 공통 비밀번호 하나로 데모 데이터를 써 볼 수 있는 모드입니다. 기존 회원가입·로그인은 그대로 함께 동작합니다.

- **켜기/끄기**: `DOKDAE_TEST_MODE=true`와 `DOKDAE_TEST_PASSWORD`(8자 이상)를 서버 환경변수로 설정하면 켜집니다. `DOKDAE_TEST_MODE`를 `false`로 바꾸거나 지우면 꺼집니다. 꺼지면 `/test-login`은 404이고 남아 있던 테스트 쿠키는 무시·삭제됩니다.
- **세션**: 비밀번호는 서버에서만 확인합니다(상수 시간 비교, 같은 IP에서 10분에 10번까지 실패 허용). 통과하면 HMAC 서명된 httpOnly·Secure·SameSite=Lax 쿠키가 8시간 동안 유지됩니다. 서명 키는 비밀번호에서 만들기 때문에 비밀번호를 바꾸면 모든 테스트 세션이 즉시 만료됩니다. 화면 상단 배너의 "테스트 종료"로 직접 끝낼 수도 있습니다.
- **데이터 격리**: 테스트 세션 요청은 Supabase 클라이언트를 만들지 않습니다(운영 DB를 읽지도 쓰지도 않음). 로그인할 때마다 새 "테스트 공간"(시드된 mock DB)이 생겨 테스트하는 사람끼리 데이터가 섞이지 않습니다. 두 사람이 1:1 흐름을 함께 시험하려면 배너의 공간 코드를 다른 브라우저의 `/test-login`에 입력해 같은 공간에 들어갑니다.
- **데이터 유지 한계(중요)**: 테스트 공간은 서버 프로세스 메모리에만 있습니다. Vercel 같은 서버리스 환경에서는
  - 함수 인스턴스가 재시작·교체·축소되면 데이터가 사라지고,
  - 요청이 다른 인스턴스로 가면 그 인스턴스에서 공간이 시드 상태로 새로 만들어집니다(배너에 안내 표시). 이때 이전 URL의 모임·독대가 "찾을 수 없음"으로 보일 수 있습니다.
  - 실시간 반영은 Supabase Realtime이 아니라 주기적 재조회입니다.

  따라서 화면·흐름 확인용으로만 쓰고, 데이터가 유지되어야 하는 테스트는 별도 Supabase 프로젝트(스테이징)를 쓰세요.

## Supabase 설정과 마이그레이션 적용 (원격 적용 전 체크리스트)

1. **API 키**: 대시보드 > Project Settings > API Keys에서 URL과 publishable key를 `.env.local`에 넣고 `DOKDAE_DATA_SOURCE=supabase`를 추가합니다.
2. **인증 설정**(대시보드 > Authentication):
   - Email provider 사용, 최소 비밀번호 길이 8자 권장(앱도 8자 이상만 허용)
   - URL Configuration: Site URL = 배포 주소, Redirect URLs에 `http://localhost:3000/auth/callback`, `https://<배포 도메인>/auth/callback` 추가
   - "Confirm email"이 켜져 있으면 가입 후 메일 링크를 눌러야 로그인됩니다(`/auth/callback`이 처리).
3. **마이그레이션 적용**(아직 실행하지 않았습니다. 적용 전에 SQL을 검토하세요):
   ```bash
   npx supabase login
   npx supabase link --project-ref <프로젝트 ref>
   npx supabase db push --dry-run   # 적용될 마이그레이션 확인
   npx supabase db push
   ```
   또는 대시보드 SQL Editor에서 `supabase/migrations/*.sql`을 파일명 순서대로 실행합니다.
4. **적용 후 확인**: 대시보드 > Database > Publications의 `supabase_realtime`에 `pair_sessions`, `wallets`, `question_unlocks`, `token_transactions`가 들어갔는지 확인하고, Security Advisor 경고를 확인합니다.
5. **예약 정리(선택)**: `SUPABASE_SECRET_KEY`, `CRON_SECRET`을 서버 환경변수로 설정합니다. Vercel에서는 `vercel.json`의 Cron이 매일 18:00 UTC(03:00 KST)에 `/api/cron/maintenance`를 호출합니다.

## Vercel 배포

1. GitHub 저장소를 Vercel에 연결합니다.
2. Environment Variables에 `DOKDAE_DATA_SOURCE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`(배포 주소), 필요하면 `SUPABASE_SECRET_KEY`, `CRON_SECRET`을 등록합니다.
3. Supabase Redirect URLs에 배포 도메인의 `/auth/callback`을 추가합니다.
4. (선택) 비회원 테스트 모드: `DOKDAE_TEST_MODE=true`, `DOKDAE_TEST_PASSWORD`를 **Sensitive**로 등록하고 다시 배포합니다. 끌 때는 `DOKDAE_TEST_MODE`를 `false`로 바꾸고 다시 배포합니다.

## 구조

```
supabase/
  config.toml               로컬 CLI 설정 (원격 프로젝트 설정과는 별개)
  migrations/               001 스키마 · 002 RLS/권한 · 003 RPC · 004 Realtime
  tests/                    PGlite 하네스 + DB 테스트
src/
  proxy.ts                  Supabase 세션 갱신 (supabase 모드)
  app/                      화면, Server Action(app/actions), /auth/callback, /api/cron/maintenance
  components/               UI (live-refresh: Realtime 구독 + 재조회)
  lib/
    config.ts               데이터 소스 선택
    auth/session.ts         현재 사용자 (mock 쿠키 / Supabase getClaims)
    supabase/               server · client(브라우저) · proxy · admin(server-only, 비밀 키)
    data/
      repository.ts         화면 ↔ 데이터 소스 계약(DokdaeRepository)
      mock/                 임시 구현과 테스트
      supabase/             RPC 어댑터와 오류 변환
```

## 보안 설계 요약

- **테이블 쓰기 권한 없음**: `anon`은 아무 권한이 없고, `authenticated`는 테이블에 SELECT만 가집니다(RLS로 행 제한). 모든 변경은 `SECURITY DEFINER` RPC로만 일어나며 함수 안에서 로그인 사용자·모임 소속·상태 전환·잔액을 검증합니다. 모든 정의자 함수는 `search_path = ''`로 고정되어 있습니다.
- **답변 원문**: 별도 테이블이며 RLS로 "소유자" 또는 "활성 모임의 활성 독대에서 연 상대"만 읽을 수 있습니다. 종료 즉시(기록 보관 중이어도) 읽을 수 없습니다.
- **초대 코드**: SHA-256 해시만 저장하며, 해시 컬럼은 컬럼 단위 GRANT에서 제외해 조회할 수 없습니다.
- **운영자 권한**: 역할은 `create_room` RPC만 부여하며, 참여자는 역할·소유자를 직접 바꿀 수 없습니다.
- **정산**: 질문 열기·선물은 독대 행을 잠근 뒤 두 지갑을 사용자 ID 순서로 잠그고, 차감·증가·거래 기록·열람 기록을 한 트랜잭션에서 처리합니다. 잔액은 `CHECK (balance >= 0)`, 초기 지급과 선물 요청 ID는 유니크 인덱스로도 한 번만 허용됩니다.
- **비밀 키**: `SUPABASE_SECRET_KEY`는 `server-only` 모듈에서만 읽으며, 빌드된 브라우저 번들에 비밀 키 이름이 없는 것을 확인했습니다.
- 참고: 데이터베이스 프로젝트 소유자는 기술적으로 저장된 모든 데이터에 접근할 수 있습니다. RLS는 참여자 사이의 접근을 막는 장치이며 소유자로부터의 암호화가 아닙니다.

## 알려진 한계

- DB 테스트는 PGlite(단일 연결)에서 실행되므로 **진짜 동시 요청 경쟁은 검증하지 못했습니다**. 동시성은 행 잠금·유니크 제약 설계로 보장하며, 원격/로컬 Supabase에서 별도 부하 테스트가 필요합니다.
- Supabase API 계층(PostgREST, Realtime, Auth 메일)은 실제 프로젝트에서 아직 확인하지 않았습니다.
- 보관 기간이 지난 기록은 하루 한 번 Cron으로 삭제되므로 최대 하루 늦게 지워질 수 있습니다(보관 0일은 즉시 삭제).
- 보관 0일이면 독대별 거래 기록이 삭제되므로, 이후에는 지갑 잔액과 남은 거래 기록의 합이 일치하지 않습니다(명세의 삭제 정책에 따른 의도된 결과).
- 초대 코드 입력 시도 횟수 제한(무차별 대입 방지)은 아직 없습니다.
