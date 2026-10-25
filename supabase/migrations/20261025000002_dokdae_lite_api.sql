-- 독대 라이트: Publishable Key(anon 역할)만으로 동작하는 공개 API 함수.
--
-- 배경: 앱은 서버 비밀키(service_role)를 쓰지 않는다. 그래서 브라우저·서버 모두 anon 역할로 PostgREST에 접근한다.
-- 이 상태에서 보안을 지키는 방법:
--  * dd_* 테이블은 그대로 RLS 활성 + 정책 없음 + anon/authenticated 권한 없음 => 테이블은 API로 읽고 쓸 수 없다.
--  * 앞 마이그레이션의 내부 함수(참가자 ID를 인자로 받는 함수)는 계속 service_role 전용이라 anon이 호출할 수 없다.
--  * 이 파일의 dd_api_* 함수만 anon에 열린다. 모두 SECURITY DEFINER 이고, "방 ID + 참가자 비밀 토큰"을 받아
--    함수 안에서 SHA-256 해시로 참가자를 확인한 뒤(dd_resolve) 내부 함수를 호출한다.
--    토큰을 모르면 어떤 참가자로도 행동할 수 없다(256비트 난수).
--  * 사진은 Storage 대신 DB(bytea)에 저장한다. Storage는 anon 업로드 정책이 필요해 접근 통제를 약화시키기 때문이다.
--  * 관리자 질문 수정은 DB에 저장된 "관리자 증명 해시"와 일치할 때만 허용하고, 실패 횟수를 DB에서 제한한다.

-- ---------------------------------------------------------------------------
-- 사진(DB 저장, 비공개)
-- ---------------------------------------------------------------------------
create table public.dd_photos (
  participant_id uuid primary key references public.dd_participants (id) on delete cascade,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) between 1 and 1048576),
  updated_at timestamptz not null default now()
);
alter table public.dd_photos enable row level security;
revoke all on table public.dd_photos from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 관리자 증명 해시(운영자가 SQL Editor에서 한 번 등록). 비어 있으면 관리자 질문 수정은 항상 거절된다.
-- ---------------------------------------------------------------------------
create table public.dd_admin_proof (
  id boolean primary key default true check (id),
  proof_hash text not null check (proof_hash ~ '^[0-9a-f]{64}$'),
  fail_count integer not null default 0,
  fail_window_start timestamptz
);
alter table public.dd_admin_proof enable row level security;
revoke all on table public.dd_admin_proof from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 내부: 토큰 → 참가자 ID (anon 에게는 열지 않는다)
-- ---------------------------------------------------------------------------
create function public.dd_hash_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_text, ''), 'UTF8')), 'hex')
$$;

create function public.dd_resolve(p_room uuid, p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from public.dd_participants
    where room_id = p_room and token_hash = public.dd_hash_text(p_token);
  if v is null then
    perform public.dd_fail('UNAUTHENTICATED');
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 공개 API (anon 실행 가능). 모두 방 ID + 비밀 토큰으로 참가자를 확인한다.
-- ---------------------------------------------------------------------------
create function public.dd_api_create_room(p_name text, p_code text, p_token text, p_nickname text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.dd_create_room(p_name, p_code, public.dd_hash_text(p_token), p_nickname)
$$;

create function public.dd_api_join_room(p_code text, p_token text, p_nickname text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.dd_join_room(p_code, public.dd_hash_text(p_token), p_nickname)
$$;

-- 인증 확인: 일치하는 참가자가 없으면 null (예외를 던지지 않는다)
create function public.dd_api_authenticate(p_room uuid, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.dd_authenticate(p_room, public.dd_hash_text(p_token))
$$;

create function public.dd_api_overview(p_room uuid, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.dd_overview(public.dd_resolve(p_room, p_token))
$$;

create function public.dd_api_my_questions(p_room uuid, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.dd_my_questions(public.dd_resolve(p_room, p_token))
$$;

create function public.dd_api_update_profile(p_room uuid, p_token text, p_nickname text, p_bio text)
returns void language sql security definer set search_path = '' as $$
  select public.dd_update_profile(public.dd_resolve(p_room, p_token), p_nickname, p_bio)
$$;

create function public.dd_api_save_answer(p_room uuid, p_token text, p_question uuid, p_body text)
returns void language sql security definer set search_path = '' as $$
  select public.dd_save_answer(public.dd_resolve(p_room, p_token), p_question, p_body)
$$;

create function public.dd_api_add_question(p_room uuid, p_token text, p_body text)
returns uuid language sql security definer set search_path = '' as $$
  select public.dd_add_question(public.dd_resolve(p_room, p_token), p_body)
$$;

create function public.dd_api_update_question(p_room uuid, p_token text, p_question uuid, p_body text)
returns void language sql security definer set search_path = '' as $$
  select public.dd_update_question(public.dd_resolve(p_room, p_token), p_question, p_body)
$$;

create function public.dd_api_delete_question(p_room uuid, p_token text, p_question uuid)
returns void language sql security definer set search_path = '' as $$
  select public.dd_delete_question(public.dd_resolve(p_room, p_token), p_question)
$$;

create function public.dd_api_mark_ready(p_room uuid, p_token text)
returns void language sql security definer set search_path = '' as $$
  select public.dd_mark_ready(public.dd_resolve(p_room, p_token))
$$;

create function public.dd_api_request_pair(p_room uuid, p_token text, p_peer uuid)
returns uuid language sql security definer set search_path = '' as $$
  select public.dd_request_pair(public.dd_resolve(p_room, p_token), p_peer)
$$;

create function public.dd_api_respond_pair(p_room uuid, p_token text, p_pair uuid, p_accept boolean)
returns text language sql security definer set search_path = '' as $$
  select public.dd_respond_pair(public.dd_resolve(p_room, p_token), p_pair, p_accept)
$$;

create function public.dd_api_consent(p_room uuid, p_token text, p_pair uuid)
returns text language sql security definer set search_path = '' as $$
  select public.dd_consent(public.dd_resolve(p_room, p_token), p_pair)
$$;

create function public.dd_api_end_pair(p_room uuid, p_token text, p_pair uuid)
returns text language sql security definer set search_path = '' as $$
  select public.dd_end_pair(public.dd_resolve(p_room, p_token), p_pair)
$$;

create function public.dd_api_view_pair(p_room uuid, p_token text, p_pair uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.dd_view_pair(public.dd_resolve(p_room, p_token), p_pair)
$$;

-- 내 사진 저장. 형식(MIME + 파일 앞부분)과 크기를 DB에서도 검증한다.
create function public.dd_api_set_photo(p_room uuid, p_token text, p_mime text, p_data bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.dd_resolve(p_room, p_token);
  v_ok boolean;
begin
  if p_data is null or octet_length(p_data) not between 1 and 1048576 then
    perform public.dd_fail('PHOTO_INVALID');
  end if;
  v_ok := case p_mime
    when 'image/jpeg' then substring(p_data from 1 for 3) = '\xffd8ff'::bytea
    when 'image/png' then substring(p_data from 1 for 8) = '\x89504e470d0a1a0a'::bytea
    when 'image/webp' then substring(p_data from 1 for 4) = '\x52494646'::bytea
                        and substring(p_data from 9 for 4) = '\x57454250'::bytea
    else false
  end;
  if not coalesce(v_ok, false) then
    perform public.dd_fail('PHOTO_INVALID');
  end if;
  insert into public.dd_photos (participant_id, mime, data) values (v_me, p_mime, p_data)
    on conflict (participant_id) do update set mime = excluded.mime, data = excluded.data, updated_at = now();
  update public.dd_participants set photo_path = 'db' where id = v_me;
end;
$$;

-- 같은 방 참가자의 사진만 돌려준다. 없거나 다른 방이면 null.
create function public.dd_api_get_photo(p_room uuid, p_token text, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.dd_resolve(p_room, p_token);
begin
  return (
    select jsonb_build_object('mime', ph.mime, 'data', encode(ph.data, 'base64'))
    from public.dd_photos ph
    join public.dd_participants t on t.id = ph.participant_id
    join public.dd_participants v on v.id = v_me
    where t.id = p_target and t.room_id = v.room_id
  );
end;
$$;

-- 기본 질문 문구(비밀 아님: 모든 참가자에게 이미 보이는 내용). 관리자 화면용.
create function public.dd_api_default_questions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'body', body, 'hint', hint, 'position', position
  ) order by position, created_at), '[]'::jsonb)
  from public.dd_questions where kind = 'default'
$$;

-- 관리자 질문 수정. 'ok' | 'denied' | 'locked' | 'not_found' 를 돌려준다.
-- 실패 횟수를 DB에 남겨야 하므로 예외 대신 상태값을 돌려준다(예외는 트랜잭션과 함께 되돌려짐).
create function public.dd_api_admin_update_question(
  p_proof text, p_id uuid, p_title text, p_body text, p_hint text, p_position integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dd_admin_proof;
begin
  select * into v from public.dd_admin_proof for update;
  if not found then
    return 'denied'; -- 관리자 증명이 등록되지 않으면 항상 거절
  end if;
  if v.fail_window_start is null or v.fail_window_start < now() - interval '10 minutes' then
    update public.dd_admin_proof set fail_count = 0, fail_window_start = now();
    v.fail_count := 0;
  end if;
  if v.fail_count >= 10 then
    return 'locked';
  end if;
  if public.dd_hash_text(p_proof) <> v.proof_hash then
    update public.dd_admin_proof set fail_count = fail_count + 1;
    return 'denied';
  end if;
  update public.dd_questions
    set title = btrim(p_title), body = btrim(p_body), hint = btrim(coalesce(p_hint, '')), position = p_position
    where id = p_id and kind = 'default';
  if not found then
    return 'not_found';
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 권한: 내부 헬퍼는 anon 에게 열지 않고, dd_api_* 만 anon/authenticated 에 연다.
-- ---------------------------------------------------------------------------
revoke all on function public.dd_hash_text(text), public.dd_resolve(uuid, text) from public, anon, authenticated;

revoke all on function
  public.dd_api_create_room(text, text, text, text), public.dd_api_join_room(text, text, text),
  public.dd_api_authenticate(uuid, text), public.dd_api_overview(uuid, text), public.dd_api_my_questions(uuid, text),
  public.dd_api_update_profile(uuid, text, text, text), public.dd_api_save_answer(uuid, text, uuid, text),
  public.dd_api_add_question(uuid, text, text), public.dd_api_update_question(uuid, text, uuid, text),
  public.dd_api_delete_question(uuid, text, uuid), public.dd_api_mark_ready(uuid, text),
  public.dd_api_request_pair(uuid, text, uuid), public.dd_api_respond_pair(uuid, text, uuid, boolean),
  public.dd_api_consent(uuid, text, uuid), public.dd_api_end_pair(uuid, text, uuid),
  public.dd_api_view_pair(uuid, text, uuid), public.dd_api_set_photo(uuid, text, text, bytea),
  public.dd_api_get_photo(uuid, text, uuid), public.dd_api_default_questions(),
  public.dd_api_admin_update_question(text, uuid, text, text, text, integer)
  from public;

grant execute on function
  public.dd_api_create_room(text, text, text, text), public.dd_api_join_room(text, text, text),
  public.dd_api_authenticate(uuid, text), public.dd_api_overview(uuid, text), public.dd_api_my_questions(uuid, text),
  public.dd_api_update_profile(uuid, text, text, text), public.dd_api_save_answer(uuid, text, uuid, text),
  public.dd_api_add_question(uuid, text, text), public.dd_api_update_question(uuid, text, uuid, text),
  public.dd_api_delete_question(uuid, text, uuid), public.dd_api_mark_ready(uuid, text),
  public.dd_api_request_pair(uuid, text, uuid), public.dd_api_respond_pair(uuid, text, uuid, boolean),
  public.dd_api_consent(uuid, text, uuid), public.dd_api_end_pair(uuid, text, uuid),
  public.dd_api_view_pair(uuid, text, uuid), public.dd_api_set_photo(uuid, text, text, bytea),
  public.dd_api_get_photo(uuid, text, uuid), public.dd_api_default_questions(),
  public.dd_api_admin_update_question(text, uuid, text, text, text, integer)
  to anon, authenticated;
