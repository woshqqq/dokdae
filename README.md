# 독대

같은 방 사람과 1:1로 대화할 때 쓰는 모바일 우선 웹앱입니다. (이전 토큰 정산 방식의 개발 명세는 [CLAUDE.md](CLAUDE.md)에 남아 있습니다.)

## 독대 라이트 — 현재 기본 흐름

이메일 가입·인증 없이, 방과 참가자별 비밀 토큰만으로 독대를 진행하는 최소 기능 버전입니다. 홈(`/`)이 이 흐름의 입구이고, 이전의 계정·토큰 정산 화면(`/rooms`, `/sessions`, `/test-login`)은 삭제하지 않았지만 홈에서 연결하지 않습니다.

> **상태: 원격 Supabase 미적용.** 마이그레이션은 작성·로컬 검증(PGlite)만 했고 어떤 원격 DB에도 적용하지 않았습니다. 이 흐름은 mock 모드가 없고 **Supabase가 필수**입니다. 서버 비밀키(`service_role`/secret key)는 **쓰지 않고**, Publishable Key만 사용합니다(데이터는 서버에 영구 저장). Supabase 프로젝트 연결 전에는 방을 만들 수 없습니다.

### 사용 흐름

1. 방문자가 `/`에서 **방 만들기**(방 이름 + 닉네임). 방 생성자는 방 화면에서 초대 코드(`ABCD-EFGH`)를 봅니다.
2. 다른 사람이 **초대 코드 + 닉네임**으로 입장합니다.
3. 각자 프로필(닉네임·사진·소개)을 쓰고, 질문에 답하거나 건너뜁니다. 개인 질문을 추가해 **기본 5개 포함 최소 10개**를 구성해야 "준비 완료"가 됩니다.
4. 준비된 참가자에게 **독대 요청** → 상대가 **수락**하면 서로의 소개·답변이 열립니다(확인 단계).
5. **양쪽이 모두 동의**하면 독대가 시작됩니다. 한쪽이라도 그만두면 상대의 내용은 다시 가려집니다.
6. 독대 종료 시 상태가 `closed`로 DB에 남고, 상대의 소개·답변은 더 이상 보이지 않습니다.

### 두 브라우저로 직접 테스트하기

1. 아래 "로컬 실행"대로 서버를 띄웁니다.
2. 브라우저 **A**(일반 창)에서 `http://localhost:3000` → 방 만들기 → 초대 코드를 확인합니다.
3. 브라우저 **B**(시크릿 창 또는 다른 브라우저 — 쿠키가 공유되지 않아야 합니다)에서 같은 주소 → 초대 코드로 입장합니다.
4. A·B 모두 질문 화면에서 개인 질문 5개를 추가하고 답변 몇 개를 쓴 뒤 "질문 구성 마치기"를 누릅니다.
5. A가 참가자 목록의 B에게 **독대 요청** → B 화면(자동 갱신, 몇 초 이내)에 요청이 뜨면 수락 → 양쪽에서 서로의 답변이 보이는지 확인 → 둘 다 **동의** → "독대가 시작됐어요" → 한쪽이 **독대 종료** → 양쪽에서 답변이 다시 가려지는지 확인합니다.
6. **비공개 확인**: 세 번째 브라우저 C로 초대 코드 입장 후, C의 화면·개발자 도구에서 A·B의 소개·답변이 보이지 않아야 합니다(참가자 목록에는 닉네임·사진·준비 여부만 있음). 다른 방의 URL(`/room/<다른 방 id>`)을 직접 열면 "입장한 기록이 없어요"가 나와야 합니다.

### 로컬 실행

```bash
npm install
cp .env.example .env.local      # PowerShell: Copy-Item .env.example .env.local
# .env.local 에 Supabase URL / publishable key, DOKDAE_ADMIN_PASSWORD 입력
npm run dev                     # http://localhost:3000
```

| 명령 | 설명 |
| --- | --- |
| `npm test` | 단위 테스트 + DB 테스트(마이그레이션을 PGlite에 적용해 권한·열람 규칙 검증) |
| `npm run typecheck` / `npm run lint` / `npm run build` | 타입 검사 / 린트 / 프로덕션 빌드 |

### 환경변수 (이 흐름)

| 변수 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (공개되어도 되는 값. 이 흐름의 데이터는 브라우저에서 직접 접근 불가) |
| `DOKDAE_ADMIN_PASSWORD` | `/admin` 비밀번호(8자 이상). 없거나 짧으면 관리자 기능이 꺼집니다 |

### DB 마이그레이션 (적용 전 검토)

새 파일 2개(원격 DB에는 아직 둘 다 없음을 읽기 전용 확인으로 확인했습니다. 이전 계정·토큰 정산용 테이블은 이미 있음):

- `20261025000001_dokdae_lite.sql` — `dd_settings`, `dd_rooms`, `dd_participants`, `dd_questions`, `dd_answers`, `dd_pairs` 테이블과 내부 함수(참가자 ID를 인자로 받는 함수, `service_role` 전용)를 **추가만** 합니다(기존 테이블·데이터를 수정·삭제하지 않음). 기본 질문 5개와 `min_questions=10`을 시드합니다.
- `20261025000002_dokdae_lite_api.sql` — Publishable Key(anon)로 호출하는 `dd_api_*` 함수(방 ID + 참가자 토큰을 DB 안에서 검증), 사진 테이블 `dd_photos`, 관리자 증명 테이블 `dd_admin_proof`를 추가합니다.

- **영향**: 모든 `dd_*` 테이블은 RLS가 켜져 있고 정책이 없으며 `anon`/`authenticated` 권한도 회수되어 Supabase API로 직접 접근할 수 없습니다. 내부 함수는 `service_role`만 실행할 수 있어 anon이 호출할 수 없고, anon에 열린 함수는 `dd_api_*`뿐입니다(모두 토큰이 없으면 `UNAUTHENTICATED`).
- **주의**: `supabase db push`는 아직 원격에 적용되지 않은 이전 마이그레이션 4개(계정·토큰 정산용 테이블)도 함께 적용합니다. 이전 방식이 필요 없다면 대시보드 SQL Editor에서 이 파일 하나만 실행해도 됩니다(이 파일은 이전 마이그레이션에 의존하지 않음).
- **적용**: `npx supabase link --project-ref <ref>` → `npx supabase db push --dry-run`으로 확인 → `npx supabase db push`.
- **롤백**(데이터가 모두 삭제됩니다):
  ```sql
  drop table if exists public.dd_pairs, public.dd_answers, public.dd_questions,
    public.dd_participants, public.dd_rooms, public.dd_settings cascade;
  drop function if exists public.dd_touch(), public.dd_fail(text), public.dd_min_questions(),
    public.dd_question_total(uuid), public.dd_actor(uuid), public.dd_is_busy(uuid, uuid),
    public.dd_create_room(text, text, text, text), public.dd_join_room(text, text, text),
    public.dd_authenticate(uuid, text), public.dd_overview(uuid), public.dd_update_profile(uuid, text, text),
    public.dd_set_photo(uuid, text), public.dd_photo_path(uuid, uuid), public.dd_my_questions(uuid),
    public.dd_save_answer(uuid, uuid, text), public.dd_add_question(uuid, text),
    public.dd_update_question(uuid, uuid, text), public.dd_delete_question(uuid, uuid),
    public.dd_mark_ready(uuid), public.dd_request_pair(uuid, uuid),
    public.dd_respond_pair(uuid, uuid, boolean), public.dd_consent(uuid, uuid),
    public.dd_end_pair(uuid, uuid), public.dd_view_pair(uuid, uuid);
  ```
  (사진은 Storage가 아니라 `dd_photos` 테이블에 저장되므로 Storage 정리는 필요 없습니다.)

### 접근 제어 설계

- **참가자 인증**: 입장 시 서버가 256비트 난수 토큰을 만들어 **HttpOnly·SameSite=Lax(운영은 Secure) 쿠키**(방별 `dd_p_<roomId>`)로만 내려주고, DB에는 SHA-256 해시만 저장합니다. 토큰은 URL·API 응답·로그에 나오지 않습니다. 쿠키가 방 ID와 일치하지 않으면 인증되지 않습니다.
- **DB 접근**: 브라우저는 Supabase에 직접 접근하지 않습니다. 서버가 Publishable Key(anon)로 `dd_api_*` 함수를 호출하며 **쿠키의 참가자 토큰 원문**을 넘깁니다. DB 함수가 토큰의 SHA-256 해시로 참가자를 확인하고(토큰·방 ID 불일치면 거절), 열람 권한(같은 방·독대 상태)도 함수 안에서 판단합니다. 토큰을 모르면 Publishable Key를 알아도 어떤 참가자로도 행동할 수 없고, 서버 코드에 실수가 있어도 DB 함수가 다른 방·제3자의 조회를 거절합니다(PGlite 테스트로 검증).
- **초대 코드**: 입장에만 쓰입니다. 코드를 안다고 해서 다른 참가자의 소개·답변을 볼 수 없습니다. 코드는 방 생성자에게만 보여주고, 잘못된 코드 입력은 IP당 10분 10회까지만 허용합니다(서버 인스턴스 메모리 기준).
- **사진**: Storage 대신 DB(`dd_photos`, 비공개 테이블)에 저장합니다(Storage는 anon 업로드 정책이 필요해 접근 통제가 약해지기 때문). 1MB 이하, JPG/PNG/WebP만 허용하며 선언된 MIME과 파일 앞부분(매직 바이트)이 모두 맞아야 하고 서버와 DB 함수가 각각 검증합니다(SVG 등 거절). 보기는 같은 방 참가자만 가능한 `/room/<방>/photo/<참가자>` 라우트로만 내려가고 공개 URL은 없습니다. 브라우저에서 올리기 전에 긴 변 800px JPEG로 줄입니다.
- **관리자(`/admin`)**: 질문 수정을 DB에 반영하려면 **한 번** `npm run admin:proof`가 출력하는 SQL을 SQL Editor에서 실행해야 합니다(비밀번호가 아닌 파생 해시만 등록됨. 등록 전에는 로그인은 되지만 저장이 거절됨). DB 쪽에서도 실패 10회/10분 잠금을 합니다. `DOKDAE_ADMIN_PASSWORD`를 서버에서만 상수 시간 비교로 확인하고, 통과하면 서명된 **2시간 만료** 세션 쿠키(HttpOnly·SameSite=Strict)를 줍니다(비밀번호를 바꾸면 기존 세션 무효). 실패는 IP당 10분 5회까지입니다. 비밀번호가 없으면 화면·액션이 모두 막힙니다. 관리자 화면은 **기본 질문 5개의 제목·본문·설명·순서만** 다루며, 참가자 정보와 답변은 읽지 않습니다. 질문 ID가 유지되어 수정해도 기존 답변은 같은 질문에 남습니다.

### 열람 규칙 요약

| 대상 | 같은 방 참가자 | 독대 상대(`reviewing`/`active`) | 제3자·다른 방 |
| --- | --- | --- | --- |
| 닉네임·사진·준비 여부 | 보임 | 보임 | 안 보임 |
| 자기소개·답변 | 안 보임 | 보임 | 안 보임 |
| 독대 종료(`closed`)·거절 후 | — | 안 보임(기록만 보관) | 안 보임 |

### 데이터 보존·개인정보

- **저장**: 방, 참가자(닉네임·소개·사진 경로·토큰 해시), 질문·답변, 독대 상태·동의 시각은 모두 Supabase DB에 저장되며 **자동 삭제하지 않습니다**(테스트가 끝나도 유지).
- **조회**: 본인은 본인 정보를 읽고 수정합니다. 상대의 소개·답변은 위 표의 단계에서만 서버가 내려줍니다. 관리자는 질문 문구만 수정하고 참가자 정보는 읽지 않습니다.
- **삭제**: 이 버전에는 사용자용 삭제 기능이 없습니다. 방 삭제 시 참가자·질문·답변·독대가 연쇄 삭제되도록 외래 키(`on delete cascade`)가 걸려 있으니, 필요하면 운영자가 Supabase 대시보드에서 `dd_rooms` 행을 삭제하세요(사진도 함께 삭제됩니다).
- **로그**: 비밀번호·토큰·답변·사진은 로그에 남기지 않습니다(오류 로그에는 오류 종류만 기록).
- 참고: Supabase 프로젝트 소유자는 기술적으로 저장된 모든 데이터에 접근할 수 있습니다. 이 앱의 권한 설계는 참가자 사이의 접근을 막는 장치이며 소유자로부터의 암호화가 아닙니다.

### 알려진 한계

- **원격 Supabase에서의 동작은 아직 확인하지 못했습니다**(마이그레이션이 원격에 적용되지 않았기 때문. 사진 업로드의 PostgREST bytea 전달도 원격에서만 확인할 수 있음). DB 규칙은 PGlite로, 서버 액션 흐름은 PGlite를 연결한 테스트로, 화면은 개발 서버 응답으로만 확인했습니다. 첫 연결 시 방 생성 → 사진 업로드 → 두 브라우저 흐름을 직접 점검하세요.
- **쿠키를 잃으면 복구할 수 없습니다**(이메일 복구 없음). 브라우저 데이터 삭제·기기 변경 시 같은 참가자로 돌아올 수 없고, 닉네임이 점유된 채 남습니다.
- 초대 코드를 아는 사람은 누구나 입장할 수 있고, 방 생성자가 참가자를 내보내는 기능은 없습니다.
- 입장 시도 제한은 서버 인스턴스 메모리 기준이라 서버리스에서는 인스턴스마다 따로 셉니다.
- 상태 반영은 Realtime이 아니라 4초 주기 재조회입니다(새로고침해도 서버 상태와 동일).
- 독대 종료는 한쪽만 눌러도 종료됩니다(이전 명세의 "양쪽 확인 종료"는 이 버전에서 단순화).
- 질문 최소 개수(10)는 `dd_settings.min_questions`에 있으며 관리자 화면에는 아직 없습니다. 기본 질문은 수정만 가능하고 추가·삭제는 하지 않습니다.
- 사진 파일 형식 검증은 매직 바이트 수준이며 이미지 재인코딩·악성 파일 스캔은 하지 않습니다(브라우저에서 JPEG로 재인코딩해 올립니다).

---

# 이전 방식: 계정·토큰 정산 (비활성)

아래는 Supabase Auth 계정과 토큰 정산을 쓰는 이전 구현입니다. 코드는 남아 있지만 홈에서 연결되지 않습니다.

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
5. **예약 정리(이전 방식 전용, 선택)**: `SUPABASE_SECRET_KEY`, `CRON_SECRET`을 서버 환경변수로 설정합니다. Vercel에서는 `vercel.json`의 Cron이 매일 18:00 UTC(03:00 KST)에 `/api/cron/maintenance`를 호출합니다.

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
