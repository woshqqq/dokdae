-- 독대 보안: 권한(GRANT), RLS 정책, 정책용 헬퍼
--
-- 최소 권한 원칙
--  * anon(비로그인)은 어떤 테이블·함수에도 접근하지 못한다.
--  * authenticated는 테이블에 SELECT만 가진다(RLS로 행 제한). INSERT/UPDATE/DELETE 권한은 없다.
--    모든 변경은 functions 마이그레이션의 SECURITY DEFINER RPC가 검증 후 수행한다.
--  * rooms.invite_code_hash 는 컬럼 단위 GRANT에서 제외해 조회 응답에 나오지 않는다.
--  * private 스키마는 API로 노출되지 않으며, RLS 정책 평가에 필요한 헬퍼만 실행 권한을 준다.

-- ---------------------------------------------------------------
-- 기본 권한 회수 (Supabase는 public 스키마 객체에 anon/authenticated 기본 권한을 준다)
-- ---------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------
-- 정책용 헬퍼 (SECURITY DEFINER: 정책 안에서 다른 테이블의 RLS 재귀를 피한다)
-- ---------------------------------------------------------------
create or replace function private.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_room_owner(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create or replace function private.member_list_visible(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.member_list_visible from public.room_settings s where s.room_id = p_room_id), false);
$$;

-- 현재 사용자와 p_other 사이에 (상태 무관) 독대 기록이 있는지. 상대 닉네임 표시에 사용.
create or replace function private.shares_session(p_room_id uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pair_sessions s
    where s.room_id = p_room_id
      and (
        (s.requester_id = (select auth.uid()) and s.recipient_id = p_other)
        or (s.recipient_id = (select auth.uid()) and s.requester_id = p_other)
      )
  );
$$;

-- 답변 원문 열람 가능 여부: 활성 모임의 활성 독대에서 현재 사용자가 연 질문인가.
-- 독대가 종료되면(기록을 보관하더라도) 즉시 false가 된다.
create or replace function private.can_read_answer(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.question_unlocks u
    join public.pair_sessions s on s.id = u.session_id
    join public.rooms r on r.id = s.room_id
    where u.question_id = p_question_id
      and u.viewer_id = (select auth.uid())
      and s.status = 'active'
      and r.status = 'active'
  );
$$;

-- 다른 참여자에게 공개되는 질문인가(활성 템플릿 또는 직접 질문 + 공개 + 답변 있음).
create or replace function private.is_public_question(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_questions q
    left join public.question_templates t on t.id = q.template_id
    where q.id = p_question_id
      and q.is_enabled
      and q.has_answer
      and (q.template_id is null or t.is_active)
  );
$$;

revoke all on function private.is_room_member(uuid) from public, anon;
revoke all on function private.is_room_owner(uuid) from public, anon;
revoke all on function private.member_list_visible(uuid) from public, anon;
revoke all on function private.shares_session(uuid, uuid) from public, anon;
revoke all on function private.can_read_answer(uuid) from public, anon;
revoke all on function private.is_public_question(uuid) from public, anon;
grant execute on function private.is_room_member(uuid) to authenticated;
grant execute on function private.is_room_owner(uuid) to authenticated;
grant execute on function private.member_list_visible(uuid) to authenticated;
grant execute on function private.shares_session(uuid, uuid) to authenticated;
grant execute on function private.can_read_answer(uuid) to authenticated;
grant execute on function private.is_public_question(uuid) to authenticated;

-- ---------------------------------------------------------------
-- RLS 활성화 (모든 사용자 데이터 테이블)
-- ---------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_settings enable row level security;
alter table public.room_members enable row level security;
alter table public.question_templates enable row level security;
alter table public.member_questions enable row level security;
alter table public.member_question_answers enable row level security;
alter table public.wallets enable row level security;
alter table public.pair_sessions enable row level security;
alter table public.question_unlocks enable row level security;
alter table public.token_transactions enable row level security;

-- ---------------------------------------------------------------
-- 조회 권한 (authenticated, SELECT만)
-- ---------------------------------------------------------------
grant select on public.profiles to authenticated;
grant select (id, name, description, owner_id, status, created_at, updated_at, closed_at, purge_at)
  on public.rooms to authenticated;
grant select on public.room_settings to authenticated;
grant select on public.room_members to authenticated;
grant select on public.question_templates to authenticated;
grant select on public.member_questions to authenticated;
grant select on public.member_question_answers to authenticated;
grant select on public.wallets to authenticated;
grant select on public.pair_sessions to authenticated;
grant select on public.question_unlocks to authenticated;
grant select on public.token_transactions to authenticated;

-- ---------------------------------------------------------------
-- SELECT 정책. INSERT/UPDATE/DELETE 정책은 만들지 않는다(=거부).
-- ---------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy rooms_select_member on public.rooms
  for select to authenticated
  using (private.is_room_member(id));

create policy room_settings_select_member on public.room_settings
  for select to authenticated
  using (private.is_room_member(room_id));

-- 본인, 운영자, 목록 공개 모임의 참여자, 독대 상대만 볼 수 있다.
create policy room_members_select on public.room_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_room_owner(room_id)
    or (private.is_room_member(room_id) and private.member_list_visible(room_id))
    or private.shares_session(room_id, user_id)
  );

create policy question_templates_select_member on public.question_templates
  for select to authenticated
  using (private.is_room_member(room_id));

-- 본인 질문 전체 + 같은 모임 참여자의 공개 질문 메타데이터.
-- 참여자 목록이 비공개면 owner_id로 참여자를 알아낼 수 없도록, room_members 정책과 같은 조건
-- (운영자 또는 독대 상대)에서만 다른 사람의 질문을 보여준다.
create policy member_questions_select on public.member_questions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      private.is_room_member(room_id)
      and private.is_public_question(id)
      and (
        private.member_list_visible(room_id)
        or private.is_room_owner(room_id)
        or private.shares_session(room_id, owner_id)
      )
    )
  );

-- 답변 원문: 소유자 또는 활성 독대에서 연 상대만
create policy member_question_answers_select on public.member_question_answers
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.can_read_answer(question_id));

create policy wallets_select_own on public.wallets
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy pair_sessions_select_participant on public.pair_sessions
  for select to authenticated
  using (requester_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy question_unlocks_select_party on public.question_unlocks
  for select to authenticated
  using (viewer_id = (select auth.uid()) or owner_id = (select auth.uid()));

-- 거래 당사자와 모임 운영자만
create policy token_transactions_select_party on public.token_transactions
  for select to authenticated
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or private.is_room_owner(room_id)
  );
