-- 독대 스키마: 테이블, 제약, 인덱스
-- 원칙
--  * 질문 메타데이터(member_questions)와 답변 원문(member_question_answers)은 분리한다.
--  * 토큰 잔액(wallets)과 거래(token_transactions)는 RPC만 변경한다(security 마이그레이션 참고).
--  * 모임을 지우면 모임에 속한 모든 데이터가 함께 지워지도록 ON DELETE CASCADE로 연결한다.

create schema if not exists private;

-- ---------------------------------------------------------------
-- 공통 트리거: updated_at 갱신
-- ---------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- 사용자 계정 프로필 (auth.users 1:1)
-- ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- 회원가입 시 프로필 자동 생성. 표시 이름은 가입 시 넘긴 display_name, 없으면 이메일 앞부분.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        '사용자'
      ),
      40
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------
-- 모임
-- ---------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  description text not null default '' check (char_length(description) <= 200),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 초대 코드는 SHA-256 해시만 저장한다. 원문은 생성·재발급 직후 한 번만 반환한다.
  invite_code_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  purge_at timestamptz,
  constraint rooms_closed_at_matches_status check ((status = 'closed') = (closed_at is not null))
);

create index rooms_owner_idx on public.rooms (owner_id);
create index rooms_purge_idx on public.rooms (purge_at) where purge_at is not null;

create trigger rooms_touch before update on public.rooms
  for each row execute function private.touch_updated_at();

-- 모임 설정. 기본값은 src/lib/data/settings.ts 의 DEFAULT_ROOM_SETTINGS 와 같아야 한다(테스트로 확인).
create table public.room_settings (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  initial_tokens integer not null default 10 check (initial_tokens between 0 and 1000),
  default_question_cost integer not null default 1 check (default_question_cost between 0 and 100),
  min_question_cost integer not null default 0 check (min_question_cost between 0 and 100),
  max_question_cost integer not null default 5 check (max_question_cost between 0 and 100),
  gifts_enabled boolean not null default true,
  gift_default_amount integer not null default 1 check (gift_default_amount between 1 and 100),
  gift_min_amount integer not null default 1 check (gift_min_amount between 1 and 100),
  gift_max_amount integer not null default 5 check (gift_max_amount between 1 and 100),
  custom_questions_enabled boolean not null default true,
  max_active_sessions_per_member integer not null default 1 check (max_active_sessions_per_member between 1 and 20),
  request_expiry_minutes integer not null default 30 check (request_expiry_minutes between 1 and 10080),
  session_retention_days integer not null default 0 check (session_retention_days between 0 and 365),
  room_retention_days integer not null default 0 check (room_retention_days between 0 and 365),
  member_list_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_settings_question_cost_range check (
    min_question_cost <= max_question_cost
    and default_question_cost between min_question_cost and max_question_cost
  ),
  constraint room_settings_gift_range check (
    gift_min_amount <= gift_max_amount
    and gift_default_amount between gift_min_amount and gift_max_amount
  )
);

create trigger room_settings_touch before update on public.room_settings
  for each row execute function private.touch_updated_at();

-- 모임 참여자. 운영자 역할은 create_room RPC만 부여한다.
create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'participant' check (role in ('owner', 'participant')),
  nickname text not null check (char_length(nickname) between 1 and 20),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create unique index room_members_one_owner_idx on public.room_members (room_id) where role = 'owner';
create index room_members_user_idx on public.room_members (user_id);

-- ---------------------------------------------------------------
-- 질문
-- ---------------------------------------------------------------
create table public.question_templates (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 100),
  description text not null default '' check (char_length(description) <= 200),
  default_cost integer not null check (default_cost between 0 and 100),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, id)
);

create index question_templates_room_idx on public.question_templates (room_id, sort_order);

create trigger question_templates_touch before update on public.question_templates
  for each row execute function private.touch_updated_at();

-- 참여자별 질문 메타데이터(제목·비용·공개 여부). 답변 원문은 담지 않는다.
create table public.member_questions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  owner_id uuid not null,
  template_id uuid,
  label_snapshot text not null check (char_length(label_snapshot) between 1 and 100),
  token_cost integer not null check (token_cost between 0 and 100),
  is_enabled boolean not null default true,
  -- 답변 존재 여부만 공개한다(원문 아님). update_profile RPC가 답변과 함께 갱신한다.
  has_answer boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (room_id, owner_id) references public.room_members (room_id, user_id) on delete cascade,
  -- 템플릿은 반드시 같은 모임의 것이어야 한다(template_id가 null이면 직접 만든 질문).
  foreign key (room_id, template_id) references public.question_templates (room_id, id) on delete cascade
);

create unique index member_questions_owner_template_idx on public.member_questions (owner_id, template_id)
  where template_id is not null;
create index member_questions_room_owner_idx on public.member_questions (room_id, owner_id, sort_order);
create index member_questions_template_idx on public.member_questions (template_id);

create trigger member_questions_touch before update on public.member_questions
  for each row execute function private.touch_updated_at();

-- 답변 원문. RLS로 소유자와 "활성 독대에서 열람한 상대"만 읽을 수 있다.
create table public.member_question_answers (
  question_id uuid primary key,
  owner_id uuid not null,
  answer text not null check (char_length(answer) between 1 and 1000),
  updated_at timestamptz not null default now(),
  foreign key (question_id, owner_id) references public.member_questions (id, owner_id) on delete cascade
);

create index member_question_answers_owner_idx on public.member_question_answers (owner_id);

create trigger member_question_answers_touch before update on public.member_question_answers
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------
-- 지갑 (모임별·참여자별)
-- ---------------------------------------------------------------
create table public.wallets (
  room_id uuid not null,
  user_id uuid not null,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id),
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);

create trigger wallets_touch before update on public.wallets
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------
-- 독대
-- ---------------------------------------------------------------
create table public.pair_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  requester_id uuid not null,
  recipient_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'cancelled', 'expired', 'closed')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  closed_at timestamptz,
  -- 종료 동의 시각. 양쪽이 모두 채워져야 closed가 된다.
  requester_end_at timestamptz,
  recipient_end_at timestamptz,
  purge_at timestamptz,
  constraint pair_sessions_distinct_members check (requester_id <> recipient_id),
  constraint pair_sessions_votes_only_when_active check (
    status in ('active', 'closed') or (requester_end_at is null and recipient_end_at is null)
  ),
  foreign key (room_id, requester_id) references public.room_members (room_id, user_id) on delete cascade,
  foreign key (room_id, recipient_id) references public.room_members (room_id, user_id) on delete cascade
);

-- 같은 두 사람 사이에는 대기·진행 중인 독대가 하나만 존재한다(방향 무관).
create unique index pair_sessions_open_pair_idx on public.pair_sessions (
  room_id, least(requester_id, recipient_id), greatest(requester_id, recipient_id)
) where status in ('pending', 'active');
create index pair_sessions_requester_idx on public.pair_sessions (room_id, requester_id, status);
create index pair_sessions_recipient_idx on public.pair_sessions (room_id, recipient_id, status);
create index pair_sessions_pending_expiry_idx on public.pair_sessions (expires_at) where status = 'pending';
create index pair_sessions_purge_idx on public.pair_sessions (purge_at) where purge_at is not null;

-- 독대별 질문 열람 권한. 새 독대에서는 다시 열어야 한다.
create table public.question_unlocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.pair_sessions (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  question_id uuid not null references public.member_questions (id) on delete cascade,
  viewer_id uuid not null,
  owner_id uuid not null,
  tokens_paid integer not null check (tokens_paid >= 0),
  created_at timestamptz not null default now(),
  constraint question_unlocks_once unique (session_id, question_id, viewer_id),
  constraint question_unlocks_not_self check (viewer_id <> owner_id)
);

create index question_unlocks_question_viewer_idx on public.question_unlocks (question_id, viewer_id);
create index question_unlocks_owner_idx on public.question_unlocks (owner_id);

-- ---------------------------------------------------------------
-- 토큰 거래 기록
-- ---------------------------------------------------------------
create table public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  session_id uuid references public.pair_sessions (id) on delete cascade,
  sender_id uuid,
  recipient_id uuid not null,
  amount integer not null check (amount > 0),
  type text not null check (type in ('initial_grant', 'unlock_payment', 'gift', 'admin_adjustment')),
  question_id uuid references public.member_questions (id) on delete set null,
  -- 선물 등 중복 요청 방지 키. 같은 모임·보낸 사람 안에서 유일하다.
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  constraint token_transactions_not_self check (sender_id is distinct from recipient_id),
  constraint token_transactions_transfer_shape check (
    type not in ('unlock_payment', 'gift') or (sender_id is not null and session_id is not null)
  ),
  constraint token_transactions_grant_shape check (type <> 'initial_grant' or sender_id is null)
);

create unique index token_transactions_idempotency_idx on public.token_transactions (room_id, sender_id, idempotency_key)
  where idempotency_key is not null;
-- 초기 토큰은 모임·사용자당 정확히 한 번만 지급된다.
create unique index token_transactions_initial_grant_once_idx on public.token_transactions (room_id, recipient_id)
  where type = 'initial_grant';
create index token_transactions_session_idx on public.token_transactions (session_id);
create index token_transactions_sender_idx on public.token_transactions (room_id, sender_id);
create index token_transactions_recipient_idx on public.token_transactions (room_id, recipient_id);
