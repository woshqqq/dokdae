-- 독대 라이트(최소 기능 MVP): 이메일 인증 없이 참가자별 비밀 토큰으로 방에 입장한다.
--
-- 설계 원칙
--  * 기존 테이블(rooms, room_members 등)은 건드리지 않는다. 이 파일은 dd_ 접두사의 새 객체만 추가한다(비파괴).
--  * 모든 dd_ 테이블에 RLS를 켜고 정책을 두지 않는다. anon/authenticated 에게는 테이블·함수 권한을 주지 않는다.
--    => 브라우저에서 Supabase API로 직접 읽거나 쓸 수 없다.
--  * 앱 서버만 service_role 로 아래 함수를 호출한다. 서버는 쿠키의 참가자 토큰 해시로 참가자를 확인(dd_authenticate)한 뒤
--    그 참가자 ID를 함수에 넘긴다. 열람 권한 판단(같은 방, 독대 상태)은 함수 안에서 다시 한다.
--  * 토큰 원문은 저장하지 않는다. SHA-256 해시(hex)만 저장한다.

-- ---------------------------------------------------------------------------
-- 공통
-- ---------------------------------------------------------------------------
create function public.dd_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 앱 전역 설정(운영 중 바꿀 수 있는 값). 질문 최소 개수 등.
create table public.dd_settings (
  key text primary key,
  int_value integer not null
);
insert into public.dd_settings (key, int_value) values ('min_questions', 10);

-- ---------------------------------------------------------------------------
-- 방과 참가자
-- ---------------------------------------------------------------------------
create table public.dd_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  -- 정규화된 초대 코드(대문자, 하이픈 없음). 방 생성자에게만 다시 보여준다.
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);

create table public.dd_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.dd_rooms (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  nickname text not null check (char_length(nickname) between 1 and 20),
  bio text not null default '' check (char_length(bio) <= 300),
  -- 비공개 Storage 버킷 안의 경로. 파일 자체는 권한 확인 라우트로만 내려간다.
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  is_creator boolean not null default false,
  -- 질문 구성을 마치고 다른 참가자와 독대할 준비가 된 시각
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dd_participants_room_nickname_key on public.dd_participants (room_id, lower(nickname));
create unique index dd_participants_one_creator_key on public.dd_participants (room_id) where is_creator;
create trigger dd_participants_touch before update on public.dd_participants
  for each row execute function public.dd_touch();

-- ---------------------------------------------------------------------------
-- 질문과 답변
--  기본 질문(kind='default')은 전역 5개로 시작하며 관리자가 문구·순서를 수정한다. ID는 고정이라 수정해도 답변 연결이 유지된다.
--  개인 질문(kind='personal')은 참가자가 추가한다.
-- ---------------------------------------------------------------------------
create table public.dd_questions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('default', 'personal')),
  room_id uuid references public.dd_rooms (id) on delete cascade,
  participant_id uuid references public.dd_participants (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 60),
  body text not null check (char_length(body) between 1 and 300),
  hint text not null default '' check (char_length(hint) <= 300),
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'default' and room_id is null and participant_id is null)
    or (kind = 'personal' and room_id is not null and participant_id is not null)
  )
);
create index dd_questions_participant_idx on public.dd_questions (participant_id) where participant_id is not null;
create trigger dd_questions_touch before update on public.dd_questions
  for each row execute function public.dd_touch();

create table public.dd_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.dd_questions (id) on delete cascade,
  participant_id uuid not null references public.dd_participants (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  updated_at timestamptz not null default now(),
  unique (question_id, participant_id)
);
create index dd_answers_participant_idx on public.dd_answers (participant_id);
create trigger dd_answers_touch before update on public.dd_answers
  for each row execute function public.dd_touch();

insert into public.dd_questions (id, kind, title, body, hint, position) values
  ('00000000-0000-4000-8000-0000000000a1', 'default', '지금의 나',
   '요즘 내 삶에서 가장 큰 부분을 차지하고 있는 것은 무엇인가요?',
   '요즘의 관심사, 고민, 몰입하고 있는 일처럼 평소 자기소개에서는 잘 드러나지 않는 현재의 나.', 1),
  ('00000000-0000-4000-8000-0000000000a2', 'default', '알아줬으면 하는 나',
   '먼저 말하기엔 조금 쑥스럽지만, 사실은 누군가 알아줬으면 하는 나의 모습이 있나요?',
   '특이한 이력, 남몰래 쌓아온 실력, 자랑스러운 경험이나 성취 등.', 2),
  ('00000000-0000-4000-8000-0000000000a3', 'default', '잘 드러나지 않는 나',
   '첫인상이나 평소 모습만으로는 잘 드러나지 않는, 나의 다른 면이 있나요?',
   '의외의 성격, 남다른 취향, 숨겨진 관심사, 사람들이 잘 모르는 나의 모습 등.', 3),
  ('00000000-0000-4000-8000-0000000000a4', 'default', '나를 둘러싼 환경',
   '다른 사람에게는 별일 아닐 수 있지만, 나에게는 유독 불편하거나 어려운 환경이 있나요?',
   '주변 소음, 복잡한 장소, 여러 사람이 동시에 말하는 상황 등.', 4),
  ('00000000-0000-4000-8000-0000000000a5', 'default', '이해받고 싶은 나',
   '나를 오해 없이 이해하려면, 상대가 알아두면 좋을 나의 특성이 있나요?',
   '감각적 특성, 기질, 건강상의 제약, 남들에게 설명하기 어려웠던 부분 등.', 5);

-- ---------------------------------------------------------------------------
-- 1:1 독대
--  requested : a(요청자)가 b에게 요청. b는 닉네임·사진만 보인다.
--  reviewing : b가 수락. 서로의 소개와 답변을 확인하는 단계. 양쪽이 동의해야 시작된다.
--  active    : 양쪽 모두 동의. 독대 진행 중.
--  closed    : 종료. 상대의 소개·답변은 다시 보이지 않는다(기록은 보존).
--  declined  : 거절되었거나 시작 전에 취소됨
-- ---------------------------------------------------------------------------
create table public.dd_pairs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.dd_rooms (id) on delete cascade,
  a_id uuid not null references public.dd_participants (id) on delete cascade,
  b_id uuid not null references public.dd_participants (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'reviewing', 'active', 'closed', 'declined')),
  a_consent_at timestamptz,
  b_consent_at timestamptz,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.dd_participants (id) on delete set null,
  check (a_id <> b_id),
  -- active 는 양쪽 동의가 있어야만 존재할 수 있다.
  check (status <> 'active' or (a_consent_at is not null and b_consent_at is not null and started_at is not null))
);
-- 같은 두 사람 사이에는 진행 중인 독대가 하나만 있을 수 있다(방향 무관).
create unique index dd_pairs_open_pair_key on public.dd_pairs (room_id, least(a_id, b_id), greatest(a_id, b_id))
  where status in ('requested', 'reviewing', 'active');
create index dd_pairs_a_idx on public.dd_pairs (a_id);
create index dd_pairs_b_idx on public.dd_pairs (b_id);

-- ---------------------------------------------------------------------------
-- RLS / 권한: 정책이 없으므로 anon·authenticated 는 아무 행도 읽거나 쓸 수 없다. 권한 자체도 회수한다.
-- ---------------------------------------------------------------------------
alter table public.dd_settings enable row level security;
alter table public.dd_rooms enable row level security;
alter table public.dd_participants enable row level security;
alter table public.dd_questions enable row level security;
alter table public.dd_answers enable row level security;
alter table public.dd_pairs enable row level security;

revoke all on table public.dd_settings, public.dd_rooms, public.dd_participants,
  public.dd_questions, public.dd_answers, public.dd_pairs from public, anon, authenticated;
grant select, insert, update, delete on table public.dd_settings, public.dd_rooms, public.dd_participants,
  public.dd_questions, public.dd_answers, public.dd_pairs to service_role;

-- ---------------------------------------------------------------------------
-- 내부 헬퍼
-- ---------------------------------------------------------------------------
create function public.dd_fail(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_code using errcode = 'P0001';
end;
$$;

create function public.dd_min_questions()
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce((select int_value from public.dd_settings where key = 'min_questions'), 10)
$$;

-- 참가자가 구성한 질문 수 = 활성 기본 질문 + 본인의 개인 질문
create function public.dd_question_total(p_participant uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select (select count(*) from public.dd_questions where kind = 'default' and is_active)::int
       + (select count(*) from public.dd_questions where kind = 'personal' and participant_id = p_participant)::int
$$;

-- 존재하는 참가자 행을 잠그고 돌려준다. 없으면 UNAUTHENTICATED.
create function public.dd_actor(p_participant uuid)
returns public.dd_participants
language plpgsql
set search_path = ''
as $$
declare
  v public.dd_participants;
begin
  select * into v from public.dd_participants where id = p_participant;
  if not found then
    perform public.dd_fail('UNAUTHENTICATED');
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 방 생성 · 입장 · 인증
-- ---------------------------------------------------------------------------
create function public.dd_create_room(p_name text, p_code text, p_token_hash text, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_participant uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if char_length(v_name) not between 1 and 60 or char_length(v_nick) not between 1 and 20 then
    perform public.dd_fail('VALIDATION');
  end if;
  insert into public.dd_rooms (name, invite_code) values (v_name, p_code) returning id into v_room;
  insert into public.dd_participants (room_id, token_hash, nickname, is_creator)
    values (v_room, p_token_hash, v_nick, true) returning id into v_participant;
  return jsonb_build_object('room_id', v_room, 'participant_id', v_participant);
end;
$$;

create function public.dd_join_room(p_code text, p_token_hash text, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_participant uuid;
  v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if char_length(v_nick) not between 1 and 20 then
    perform public.dd_fail('VALIDATION');
  end if;
  select id into v_room from public.dd_rooms where invite_code = p_code;
  if v_room is null then
    perform public.dd_fail('INVALID_CODE');
  end if;
  if exists (select 1 from public.dd_participants where room_id = v_room and lower(nickname) = lower(v_nick)) then
    perform public.dd_fail('NICKNAME_TAKEN');
  end if;
  begin
    insert into public.dd_participants (room_id, token_hash, nickname)
      values (v_room, p_token_hash, v_nick) returning id into v_participant;
  exception when unique_violation then
    perform public.dd_fail('NICKNAME_TAKEN');
  end;
  return jsonb_build_object('room_id', v_room, 'participant_id', v_participant);
end;
$$;

-- 쿠키 토큰의 해시로 참가자를 찾는다. 방 ID가 일치하지 않으면 null.
create function public.dd_authenticate(p_room uuid, p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'room_id', p.room_id, 'is_creator', p.is_creator)
  from public.dd_participants p
  where p.room_id = p_room and p.token_hash = p_token_hash
$$;

-- ---------------------------------------------------------------------------
-- 방 개요: 나, 같은 방 참가자 목록(닉네임·사진 유무만), 내 독대 목록
-- ---------------------------------------------------------------------------
create function public.dd_overview(p_participant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_room public.dd_rooms;
begin
  select * into v_room from public.dd_rooms where id = me.room_id;
  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'name', v_room.name,
      'invite_code', case when me.is_creator then v_room.invite_code else null end
    ),
    'me', jsonb_build_object(
      'id', me.id,
      'nickname', me.nickname,
      'bio', me.bio,
      'has_photo', me.photo_path is not null,
      'is_creator', me.is_creator,
      'ready', me.ready_at is not null
    ),
    'question_count', public.dd_question_total(me.id),
    'min_questions', public.dd_min_questions(),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'nickname', m.nickname,
        'has_photo', m.photo_path is not null,
        'ready', m.ready_at is not null,
        'is_creator', m.is_creator,
        -- 나와 이 사람 사이의 진행 중 독대(있다면)
        'pair', (
          select jsonb_build_object('id', p.id, 'status', p.status,
                                    'direction', case when p.a_id = me.id then 'outgoing' else 'incoming' end)
          from public.dd_pairs p
          where p.status in ('requested', 'reviewing', 'active')
            and ((p.a_id = me.id and p.b_id = m.id) or (p.b_id = me.id and p.a_id = m.id))
        )
      ) order by m.created_at)
      from public.dd_participants m
      where m.room_id = me.room_id and m.id <> me.id
    ), '[]'::jsonb),
    'pairs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'status', p.status,
        'direction', case when p.a_id = me.id then 'outgoing' else 'incoming' end,
        'peer_id', o.id,
        'peer_nickname', o.nickname,
        'requested_at', p.requested_at,
        'closed_at', p.closed_at
      ) order by p.requested_at desc)
      from public.dd_pairs p
      join public.dd_participants o on o.id = case when p.a_id = me.id then p.b_id else p.a_id end
      where p.a_id = me.id or p.b_id = me.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 프로필
-- ---------------------------------------------------------------------------
create function public.dd_update_profile(p_participant uuid, p_nickname text, p_bio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_nick text := btrim(coalesce(p_nickname, ''));
  v_bio text := btrim(coalesce(p_bio, ''));
begin
  if char_length(v_nick) not between 1 and 20 or char_length(v_bio) > 300 then
    perform public.dd_fail('VALIDATION');
  end if;
  if exists (
    select 1 from public.dd_participants
    where room_id = me.room_id and id <> me.id and lower(nickname) = lower(v_nick)
  ) then
    perform public.dd_fail('NICKNAME_TAKEN');
  end if;
  update public.dd_participants set nickname = v_nick, bio = v_bio where id = me.id;
end;
$$;

-- 새 사진 경로를 저장하고 이전 경로를 돌려준다(서버가 이전 파일을 지운다).
create function public.dd_set_photo(p_participant uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
begin
  update public.dd_participants set photo_path = p_path where id = me.id;
  return me.photo_path;
end;
$$;

-- 요청자가 대상 참가자의 사진을 볼 수 있으면(같은 방) 경로를, 아니면 null.
create function public.dd_photo_path(p_viewer uuid, p_target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.photo_path
  from public.dd_participants v
  join public.dd_participants t on t.room_id = v.room_id
  where v.id = p_viewer and t.id = p_target
$$;

-- ---------------------------------------------------------------------------
-- 질문과 답변
-- ---------------------------------------------------------------------------
create function public.dd_my_questions(p_participant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
begin
  return jsonb_build_object(
    'min_questions', public.dd_min_questions(),
    'total', public.dd_question_total(me.id),
    'ready', me.ready_at is not null,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'title', q.title, 'body', q.body, 'hint', q.hint,
        'answer', a.body
      ) order by (q.kind = 'personal'), q.position, q.created_at)
      from public.dd_questions q
      left join public.dd_answers a on a.question_id = q.id and a.participant_id = me.id
      where (q.kind = 'default' and q.is_active) or (q.kind = 'personal' and q.participant_id = me.id)
    ), '[]'::jsonb)
  );
end;
$$;

-- 답변 저장. 빈 값이면 건너뛰는 것으로 보고 기존 답변을 지운다.
create function public.dd_save_answer(p_participant uuid, p_question uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) > 2000 then
    perform public.dd_fail('VALIDATION');
  end if;
  -- 활성 기본 질문이거나 본인의 개인 질문만 답할 수 있다. 다른 사람의 질문 ID는 존재하지 않는 것처럼 취급한다.
  if not exists (
    select 1 from public.dd_questions q
    where q.id = p_question
      and ((q.kind = 'default' and q.is_active) or (q.kind = 'personal' and q.participant_id = me.id))
  ) then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v_body = '' then
    delete from public.dd_answers where question_id = p_question and participant_id = me.id;
  else
    insert into public.dd_answers (question_id, participant_id, body) values (p_question, me.id, v_body)
      on conflict (question_id, participant_id) do update set body = excluded.body;
  end if;
end;
$$;

create function public.dd_add_question(p_participant uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if char_length(v_body) not between 1 and 300 then
    perform public.dd_fail('VALIDATION');
  end if;
  if (select count(*) from public.dd_questions where participant_id = me.id) >= 30 then
    perform public.dd_fail('TOO_MANY_QUESTIONS');
  end if;
  insert into public.dd_questions (kind, room_id, participant_id, body, position)
    values ('personal', me.room_id, me.id, v_body,
            coalesce((select max(position) from public.dd_questions where participant_id = me.id), 0) + 1)
    returning id into v_id;
  return v_id;
end;
$$;

create function public.dd_update_question(p_participant uuid, p_question uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) not between 1 and 300 then
    perform public.dd_fail('VALIDATION');
  end if;
  update public.dd_questions set body = v_body
    where id = p_question and kind = 'personal' and participant_id = me.id;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
end;
$$;

create function public.dd_delete_question(p_participant uuid, p_question uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
begin
  if not exists (
    select 1 from public.dd_questions where id = p_question and kind = 'personal' and participant_id = me.id
  ) then
    perform public.dd_fail('NOT_FOUND');
  end if;
  -- 준비를 마친 뒤에는 최소 개수 아래로 줄일 수 없다.
  if me.ready_at is not null and public.dd_question_total(me.id) - 1 < public.dd_min_questions() then
    perform public.dd_fail('MIN_QUESTIONS');
  end if;
  delete from public.dd_questions where id = p_question;
end;
$$;

-- 질문 구성이 최소 개수 이상이어야 다음 단계(독대 준비 완료)로 넘어간다.
create function public.dd_mark_ready(p_participant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
begin
  if public.dd_question_total(me.id) < public.dd_min_questions() then
    perform public.dd_fail('MIN_QUESTIONS');
  end if;
  update public.dd_participants set ready_at = coalesce(ready_at, now()) where id = me.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 독대 상태 전이
-- ---------------------------------------------------------------------------
create function public.dd_request_pair(p_participant uuid, p_peer uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  peer public.dd_participants;
  v_id uuid;
begin
  select * into peer from public.dd_participants where id = p_peer and room_id = me.room_id;
  if not found or peer.id = me.id then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if me.ready_at is null then
    perform public.dd_fail('NOT_READY');
  end if;
  if peer.ready_at is null then
    perform public.dd_fail('PEER_NOT_READY');
  end if;
  begin
    insert into public.dd_pairs (room_id, a_id, b_id) values (me.room_id, me.id, peer.id) returning id into v_id;
  exception when unique_violation then
    perform public.dd_fail('PAIR_EXISTS');
  end;
  return v_id;
end;
$$;

-- 두 참가자 중 한 명이라도 이미 진행 중(reviewing/active)인 독대가 있는지
create function public.dd_is_busy(p_participant uuid, p_except uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.dd_pairs
    where status in ('reviewing', 'active') and id <> p_except and (a_id = p_participant or b_id = p_participant)
  )
$$;

create function public.dd_respond_pair(p_participant uuid, p_pair uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_pairs;
begin
  -- 두 참가자를 같은 순서로 잠가 동시 수락이 한 사람에게 둘 이상의 독대를 만들지 못하게 한다.
  perform 1 from public.dd_participants
    where id in (select a_id from public.dd_pairs where id = p_pair union select b_id from public.dd_pairs where id = p_pair)
    order by id for update;
  select * into v from public.dd_pairs where id = p_pair and b_id = me.id for update;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v.status <> 'requested' then
    perform public.dd_fail('INVALID_STATE');
  end if;
  if p_accept then
    if public.dd_is_busy(v.a_id, v.id) or public.dd_is_busy(v.b_id, v.id) then
      perform public.dd_fail('BUSY');
    end if;
    update public.dd_pairs set status = 'reviewing' where id = v.id;
    return 'reviewing';
  end if;
  update public.dd_pairs set status = 'declined', closed_at = now(), closed_by = me.id where id = v.id;
  return 'declined';
end;
$$;

-- 내 동의를 기록한다. 양쪽이 모두 동의한 순간에만 active 가 된다.
create function public.dd_consent(p_participant uuid, p_pair uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_pairs;
  v_a timestamptz;
  v_b timestamptz;
begin
  select * into v from public.dd_pairs where id = p_pair and (a_id = me.id or b_id = me.id) for update;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v.status = 'active' then
    return 'active';
  end if;
  if v.status <> 'reviewing' then
    perform public.dd_fail('INVALID_STATE');
  end if;
  v_a := case when v.a_id = me.id then coalesce(v.a_consent_at, now()) else v.a_consent_at end;
  v_b := case when v.b_id = me.id then coalesce(v.b_consent_at, now()) else v.b_consent_at end;
  if v_a is not null and v_b is not null then
    update public.dd_pairs set a_consent_at = v_a, b_consent_at = v_b, status = 'active', started_at = now()
      where id = v.id;
    return 'active';
  end if;
  update public.dd_pairs set a_consent_at = v_a, b_consent_at = v_b where id = v.id;
  return 'reviewing';
end;
$$;

-- 종료(또는 시작 전 취소). 이미 끝난 독대에 다시 호출해도 안전하다.
create function public.dd_end_pair(p_participant uuid, p_pair uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_pairs;
  v_status text;
begin
  select * into v from public.dd_pairs where id = p_pair and (a_id = me.id or b_id = me.id) for update;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v.status in ('closed', 'declined') then
    return v.status;
  end if;
  v_status := case when v.status = 'active' then 'closed' else 'declined' end;
  update public.dd_pairs set status = v_status, closed_at = now(), closed_by = me.id where id = v.id;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 상대 정보 열람: 소개와 답변은 reviewing/active 독대의 당사자에게만 내려간다.
-- ---------------------------------------------------------------------------
create function public.dd_view_pair(p_participant uuid, p_pair uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_pairs;
  peer public.dd_participants;
  v_visible boolean;
begin
  select * into v from public.dd_pairs where id = p_pair and (a_id = me.id or b_id = me.id);
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  select * into peer from public.dd_participants where id = case when v.a_id = me.id then v.b_id else v.a_id end;
  v_visible := v.status in ('reviewing', 'active');
  return jsonb_build_object(
    'pair', jsonb_build_object(
      'id', v.id,
      'status', v.status,
      'direction', case when v.a_id = me.id then 'outgoing' else 'incoming' end,
      'my_consent', (case when v.a_id = me.id then v.a_consent_at else v.b_consent_at end) is not null,
      'peer_consent', (case when v.a_id = me.id then v.b_consent_at else v.a_consent_at end) is not null,
      'requested_at', v.requested_at,
      'started_at', v.started_at,
      'closed_at', v.closed_at
    ),
    'peer', jsonb_build_object(
      'id', peer.id,
      'nickname', peer.nickname,
      'has_photo', peer.photo_path is not null,
      'bio', case when v_visible then peer.bio else null end,
      'answers', case when v_visible then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', q.id, 'kind', q.kind, 'title', q.title, 'body', q.body, 'answer', a.body
        ) order by (q.kind = 'personal'), q.position, q.created_at)
        from public.dd_questions q
        left join public.dd_answers a on a.question_id = q.id and a.participant_id = peer.id
        where (q.kind = 'default' and q.is_active) or (q.kind = 'personal' and q.participant_id = peer.id)
      ), '[]'::jsonb) else null end
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 함수 권한: service_role 만 실행할 수 있다(Supabase 기본 권한을 명시적으로 회수).
-- ---------------------------------------------------------------------------
revoke all on function
  public.dd_touch(), public.dd_fail(text), public.dd_min_questions(), public.dd_question_total(uuid),
  public.dd_actor(uuid), public.dd_is_busy(uuid, uuid),
  public.dd_create_room(text, text, text, text), public.dd_join_room(text, text, text),
  public.dd_authenticate(uuid, text), public.dd_overview(uuid),
  public.dd_update_profile(uuid, text, text), public.dd_set_photo(uuid, text), public.dd_photo_path(uuid, uuid),
  public.dd_my_questions(uuid), public.dd_save_answer(uuid, uuid, text), public.dd_add_question(uuid, text),
  public.dd_update_question(uuid, uuid, text), public.dd_delete_question(uuid, uuid), public.dd_mark_ready(uuid),
  public.dd_request_pair(uuid, uuid), public.dd_respond_pair(uuid, uuid, boolean), public.dd_consent(uuid, uuid),
  public.dd_end_pair(uuid, uuid), public.dd_view_pair(uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.dd_min_questions(), public.dd_question_total(uuid), public.dd_actor(uuid), public.dd_is_busy(uuid, uuid),
  public.dd_fail(text),
  public.dd_create_room(text, text, text, text), public.dd_join_room(text, text, text),
  public.dd_authenticate(uuid, text), public.dd_overview(uuid),
  public.dd_update_profile(uuid, text, text), public.dd_set_photo(uuid, text), public.dd_photo_path(uuid, uuid),
  public.dd_my_questions(uuid), public.dd_save_answer(uuid, uuid, text), public.dd_add_question(uuid, text),
  public.dd_update_question(uuid, uuid, text), public.dd_delete_question(uuid, uuid), public.dd_mark_ready(uuid),
  public.dd_request_pair(uuid, uuid), public.dd_respond_pair(uuid, uuid, boolean), public.dd_consent(uuid, uuid),
  public.dd_end_pair(uuid, uuid), public.dd_view_pair(uuid, uuid)
  to service_role;
