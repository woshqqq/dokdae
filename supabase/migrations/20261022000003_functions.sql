-- 독대 RPC
--
-- * 변경 함수: SECURITY DEFINER + search_path 고정. 함수 안에서 로그인 사용자(auth.uid()),
--   모임 소속, 상태 전환, 잔액을 모두 검증한다. 하나의 함수 호출은 하나의 트랜잭션이므로
--   예외가 나면 그 호출의 모든 변경이 롤백된다.
-- * 조회 함수: SECURITY INVOKER. 호출자 권한으로 실행되어 RLS가 그대로 적용된다.
-- * 오류는 message에 앱 오류 코드(src/lib/data/errors.ts)를, detail에 사용자용 문구를 담는다.

-- ===============================================================
-- 내부 헬퍼
-- ===============================================================

create or replace function private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform private.fail('UNAUTHENTICATED');
  end if;
  return v_uid;
end;
$$;

create or replace function private.effective_status(p_status text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_status = 'pending' and p_expires_at <= now() then 'expired' else p_status end;
$$;

create or replace function private.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', '', 'g'));
$$;

-- src/lib/data/mock/engine.ts 의 hashInviteCode 와 같은 값(SHA-256 hex)
create or replace function private.hash_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(private.normalize_invite_code(p_code), 'UTF8')), 'hex');
$$;

-- 혼동되는 문자(0/O, 1/I)를 뺀 32자 알파벳으로 XXXX-XXXX 코드 생성.
-- gen_random_uuid()는 암호학적 난수를 쓰며, 버전·변형 비트가 고정된 바이트(6, 8)는 피한다.
create or replace function private.random_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_positions constant int[] := array[0, 1, 2, 3, 9, 10, 11, 12];
  v_out text := '';
  i int;
begin
  for i in 1..8 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, v_positions[i]) % 32) + 1, 1);
    if i = 4 then
      v_out := v_out || '-';
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function private.validate_nickname(p_nickname text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_nickname, ''));
begin
  if char_length(v) < 1 or char_length(v) > 20 then
    perform private.fail('VALIDATION', '닉네임은 1~20자로 입력해 주세요.');
  end if;
  return v;
end;
$$;

create or replace function private.validate_label(p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_label, ''));
begin
  if char_length(v) < 1 or char_length(v) > 100 then
    perform private.fail('VALIDATION', '질문은 1~100자로 입력해 주세요.');
  end if;
  return v;
end;
$$;

create or replace function private.require_member(p_room_id uuid, p_user_id uuid)
returns public.room_members
language plpgsql
stable
set search_path = ''
as $$
declare
  v_member public.room_members;
begin
  select * into v_member from public.room_members m where m.room_id = p_room_id and m.user_id = p_user_id;
  if not found then
    perform private.fail('NOT_MEMBER');
  end if;
  return v_member;
end;
$$;

create or replace function private.require_owner(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (private.require_member(p_room_id, p_user_id)).role <> 'owner' then
    perform private.fail('FORBIDDEN');
  end if;
end;
$$;

-- 모임이 활성 상태인지 확인하며 모임 행을 공유 잠금한다(동시에 진행되는 모임 종료와 직렬화).
create or replace function private.require_active_room(p_room_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_status text;
begin
  select r.status into v_status from public.rooms r where r.id = p_room_id for share;
  if not found then
    perform private.fail('NOT_FOUND');
  end if;
  if v_status <> 'active' then
    perform private.fail('ROOM_CLOSED');
  end if;
end;
$$;

create or replace function private.active_session_count(p_room_id uuid, p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.pair_sessions s
  where s.room_id = p_room_id and s.status = 'active'
    and (s.requester_id = p_user_id or s.recipient_id = p_user_id);
$$;

-- 두 참여자 행을 정해진 순서로 잠근다(동시 수락으로 동시 독대 수 제한을 넘지 않게).
create or replace function private.lock_members(p_room_id uuid, p_a uuid, p_b uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform 1 from public.room_members m
  where m.room_id = p_room_id and m.user_id in (p_a, p_b)
  order by m.user_id
  for update;
end;
$$;

-- 독대가 끝나는 시점(종료·거절·취소·만료)에 보관 정책을 적용한다.
create or replace function private.finish_session(p_session_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_days integer;
begin
  select st.session_retention_days into v_days
  from public.pair_sessions s join public.room_settings st on st.room_id = s.room_id
  where s.id = p_session_id;
  if coalesce(v_days, 0) = 0 then
    -- 열람 기록과 독대별 거래 기록은 ON DELETE CASCADE로 함께 삭제된다. 지갑 잔액은 유지된다.
    delete from public.pair_sessions s where s.id = p_session_id;
  else
    update public.pair_sessions s set purge_at = now() + make_interval(days => v_days) where s.id = p_session_id;
  end if;
end;
$$;

create or replace function private.expire_stale_sessions(p_room_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select s.id from public.pair_sessions s
    where s.status = 'pending' and s.expires_at <= now() and (p_room_id is null or s.room_id = p_room_id)
    for update skip locked
  loop
    update public.pair_sessions s set status = 'expired', closed_at = now() where s.id = v_id;
    perform private.finish_session(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 참여자 추가: 참여자 행, 지갑, 초기 토큰 거래, 질문 메타데이터를 만든다.
-- 초기 토큰은 token_transactions_initial_grant_once_idx 로 모임·사용자당 한 번만 기록된다.
create or replace function private.add_member(p_room_id uuid, p_user_id uuid, p_role text, p_nickname text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_settings public.room_settings;
begin
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;
  insert into public.room_members (room_id, user_id, role, nickname) values (p_room_id, p_user_id, p_role, p_nickname);
  insert into public.wallets (room_id, user_id, balance) values (p_room_id, p_user_id, v_settings.initial_tokens);
  if v_settings.initial_tokens > 0 then
    insert into public.token_transactions (room_id, recipient_id, amount, type)
    values (p_room_id, p_user_id, v_settings.initial_tokens, 'initial_grant');
  end if;
  insert into public.member_questions (room_id, owner_id, template_id, label_snapshot, token_cost, is_enabled, sort_order)
  select p_room_id, p_user_id, t.id, t.label,
         least(greatest(t.default_cost, v_settings.min_question_cost), v_settings.max_question_cost),
         true, t.sort_order
  from public.question_templates t
  where t.room_id = p_room_id;
end;
$$;

-- ---------- JSON 변환 (조회 함수용, 호출자 권한으로 실행) ----------

create or replace function private.member_json(m public.room_members)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'roomId', m.room_id, 'userId', m.user_id, 'role', m.role, 'nickname', m.nickname, 'joinedAt', m.joined_at
  );
$$;

create or replace function private.settings_json(s public.room_settings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'initialTokens', s.initial_tokens,
    'defaultQuestionCost', s.default_question_cost,
    'minQuestionCost', s.min_question_cost,
    'maxQuestionCost', s.max_question_cost,
    'giftsEnabled', s.gifts_enabled,
    'giftDefaultAmount', s.gift_default_amount,
    'giftMinAmount', s.gift_min_amount,
    'giftMaxAmount', s.gift_max_amount,
    'customQuestionsEnabled', s.custom_questions_enabled,
    'maxActiveSessionsPerMember', s.max_active_sessions_per_member,
    'requestExpiryMinutes', s.request_expiry_minutes,
    'sessionRetentionDays', s.session_retention_days,
    'roomRetentionDays', s.room_retention_days,
    'memberListVisible', s.member_list_visible
  );
$$;

create or replace function private.question_meta_json(q public.member_questions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id, 'roomId', q.room_id, 'ownerId', q.owner_id, 'templateId', q.template_id,
    'label', q.label_snapshot, 'tokenCost', q.token_cost, 'isEnabled', q.is_enabled,
    'sortOrder', q.sort_order, 'hasAnswer', q.has_answer
  );
$$;

create or replace function private.session_json(s public.pair_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'roomId', s.room_id, 'requesterId', s.requester_id, 'recipientId', s.recipient_id,
    'status', private.effective_status(s.status, s.expires_at),
    'requestedAt', s.requested_at, 'expiresAt', s.expires_at, 'acceptedAt', s.accepted_at,
    'closedAt', s.closed_at, 'requesterEndAt', s.requester_end_at, 'recipientEndAt', s.recipient_end_at,
    'purgeAt', s.purge_at
  );
$$;

create or replace function private.session_summary(s public.pair_sessions, p_viewer uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'status', private.effective_status(s.status, s.expires_at),
    'partner', jsonb_build_object(
      'userId', case when s.requester_id = p_viewer then s.recipient_id else s.requester_id end,
      'nickname', coalesce(
        (select m.nickname from public.room_members m
         where m.room_id = s.room_id
           and m.user_id = case when s.requester_id = p_viewer then s.recipient_id else s.requester_id end),
        '(나간 참여자)'
      )
    ),
    'isRequester', s.requester_id = p_viewer,
    'requestedAt', s.requested_at,
    'expiresAt', s.expires_at,
    'endRequested', s.requester_end_at is not null or s.recipient_end_at is not null
  );
$$;

-- ===============================================================
-- 조회 RPC (SECURITY INVOKER — RLS 적용)
-- ===============================================================

create or replace function public.list_my_rooms()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'room', jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'status', r.status),
        'role', m.role,
        'nickname', m.nickname,
        'balance', coalesce(w.balance, 0)
      ) order by m.joined_at
    )
    from public.room_members m
    join public.rooms r on r.id = m.room_id
    left join public.wallets w on w.room_id = m.room_id and w.user_id = m.user_id
    where m.user_id = v_uid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_room_dashboard(p_room_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_me public.room_members := private.require_member(p_room_id, v_uid);
  v_settings public.room_settings;
  v_room jsonb;
  v_members jsonb;
  v_sessions jsonb;
begin
  select jsonb_build_object(
    'id', r.id, 'name', r.name, 'description', r.description, 'ownerId', r.owner_id, 'status', r.status,
    'createdAt', r.created_at, 'closedAt', r.closed_at, 'purgeAt', r.purge_at
  ) into v_room
  from public.rooms r where r.id = p_room_id;

  select * into v_settings from public.room_settings s where s.room_id = p_room_id;

  if v_settings.member_list_visible or v_me.role = 'owner' then
    select coalesce(jsonb_agg(private.member_json(m) order by m.joined_at), '[]'::jsonb) into v_members
    from public.room_members m where m.room_id = p_room_id;
  else
    v_members := 'null'::jsonb;
  end if;

  select coalesce(jsonb_agg(private.session_summary(s, v_uid) order by s.requested_at desc), '[]'::jsonb) into v_sessions
  from public.pair_sessions s
  where s.room_id = p_room_id
    and (s.requester_id = v_uid or s.recipient_id = v_uid)
    and (s.status = 'active' or (s.status = 'pending' and s.expires_at > now()));

  return jsonb_build_object(
    'room', v_room,
    'settings', private.settings_json(v_settings),
    'me', private.member_json(v_me),
    'balance', coalesce((select w.balance from public.wallets w where w.room_id = p_room_id and w.user_id = v_uid), 0),
    'members', v_members,
    'incomingRequests', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_sessions) e
                         where e ->> 'status' = 'pending' and not (e ->> 'isRequester')::boolean),
    'outgoingRequests', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_sessions) e
                         where e ->> 'status' = 'pending' and (e ->> 'isRequester')::boolean),
    'activeSessions', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_sessions) e
                       where e ->> 'status' = 'active')
  );
end;
$$;

create or replace function public.get_profile_editor(p_room_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_me public.room_members := private.require_member(p_room_id, v_uid);
  v_settings public.room_settings;
begin
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;
  return jsonb_build_object(
    'room', (select jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status) from public.rooms r where r.id = p_room_id),
    'settings', jsonb_build_object(
      'minQuestionCost', v_settings.min_question_cost,
      'maxQuestionCost', v_settings.max_question_cost,
      'defaultQuestionCost', v_settings.default_question_cost,
      'customQuestionsEnabled', v_settings.custom_questions_enabled
    ),
    'me', private.member_json(v_me),
    'questions', coalesce((
      select jsonb_agg(
        private.question_meta_json(q) || jsonb_build_object('answer', coalesce(a.answer, ''))
        order by q.sort_order, q.created_at
      )
      from public.member_questions q
      left join public.question_templates t on t.id = q.template_id
      left join public.member_question_answers a on a.question_id = q.id
      where q.room_id = p_room_id and q.owner_id = v_uid and (q.template_id is null or t.is_active)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_member_profile(p_room_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_me public.room_members := private.require_member(p_room_id, v_uid);
  v_member public.room_members;
  v_room_status text;
  v_settings public.room_settings;
  v_open public.pair_sessions;
  v_is_me boolean := p_member_id = v_uid;
  v_can jsonb := jsonb_build_object('ok', true);
begin
  select * into v_member from public.room_members m where m.room_id = p_room_id and m.user_id = p_member_id;
  if not found then
    perform private.fail('NOT_FOUND');
  end if;
  select r.status into v_room_status from public.rooms r where r.id = p_room_id;
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;

  if not v_is_me then
    select * into v_open from public.pair_sessions s
    where s.room_id = p_room_id
      and ((s.requester_id = v_uid and s.recipient_id = p_member_id) or (s.requester_id = p_member_id and s.recipient_id = v_uid))
      and (s.status = 'active' or (s.status = 'pending' and s.expires_at > now()))
    limit 1;
  end if;

  if v_is_me then
    v_can := jsonb_build_object('ok', false, 'reason', '본인에게는 독대를 요청할 수 없습니다.');
  elsif v_room_status <> 'active' then
    v_can := jsonb_build_object('ok', false, 'reason', '종료된 모임입니다.');
  elsif v_open.id is not null then
    v_can := jsonb_build_object('ok', false, 'reason', '이미 대기 중이거나 진행 중인 독대가 있습니다.');
  elsif private.active_session_count(p_room_id, v_uid) >= v_settings.max_active_sessions_per_member then
    v_can := jsonb_build_object('ok', false, 'reason',
      format('동시에 진행할 수 있는 독대는 %s개입니다.', v_settings.max_active_sessions_per_member));
  end if;

  return jsonb_build_object(
    'room', (select jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status) from public.rooms r where r.id = p_room_id),
    'member', private.member_json(v_member),
    'isMe', v_is_me,
    'questions', coalesce((
      select jsonb_agg(private.question_meta_json(q) order by q.sort_order, q.created_at)
      from public.member_questions q
      left join public.question_templates t on t.id = q.template_id
      where q.room_id = p_room_id and q.owner_id = p_member_id
        and q.is_enabled and q.has_answer and (q.template_id is null or t.is_active)
    ), '[]'::jsonb),
    'openSession', case when v_open.id is null then null else private.session_summary(v_open, v_uid) end,
    'canRequest', v_can
  );
end;
$$;

create or replace function public.get_session_view(p_session_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_s public.pair_sessions;
  v_me public.room_members;
  v_partner public.room_members;
  v_partner_id uuid;
  v_room_status text;
  v_settings public.room_settings;
  v_can_read boolean;
  v_my_end timestamptz;
  v_partner_end timestamptz;
begin
  -- 당사자가 아니면 존재 여부도 알려주지 않는다.
  select * into v_s from public.pair_sessions s
  where s.id = p_session_id and (s.requester_id = v_uid or s.recipient_id = v_uid);
  if not found then
    perform private.fail('NOT_FOUND');
  end if;

  v_partner_id := case when v_s.requester_id = v_uid then v_s.recipient_id else v_s.requester_id end;
  select * into v_me from public.room_members m where m.room_id = v_s.room_id and m.user_id = v_uid;
  select * into v_partner from public.room_members m where m.room_id = v_s.room_id and m.user_id = v_partner_id;
  if v_me.user_id is null or v_partner.user_id is null then
    perform private.fail('NOT_FOUND');
  end if;
  select r.status into v_room_status from public.rooms r where r.id = v_s.room_id;
  select * into v_settings from public.room_settings st where st.room_id = v_s.room_id;

  -- 답변 원문은 독대가 active이고 이 독대에서 열람했을 때만 포함한다(RLS도 같은 조건을 강제).
  v_can_read := v_s.status = 'active' and v_room_status = 'active';
  v_my_end := case when v_s.requester_id = v_uid then v_s.requester_end_at else v_s.recipient_end_at end;
  v_partner_end := case when v_s.requester_id = v_uid then v_s.recipient_end_at else v_s.requester_end_at end;

  return jsonb_build_object(
    'session', private.session_json(v_s),
    'room', (select jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status) from public.rooms r where r.id = v_s.room_id),
    'settings', jsonb_build_object(
      'giftsEnabled', v_settings.gifts_enabled,
      'giftDefaultAmount', v_settings.gift_default_amount,
      'giftMinAmount', v_settings.gift_min_amount,
      'giftMaxAmount', v_settings.gift_max_amount,
      'sessionRetentionDays', v_settings.session_retention_days
    ),
    'me', private.member_json(v_me),
    'partner', private.member_json(v_partner),
    'myBalance', coalesce((select w.balance from public.wallets w where w.room_id = v_s.room_id and w.user_id = v_uid), 0),
    'partnerQuestions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'meta', private.question_meta_json(q),
          'unlocked', u.id is not null,
          'tokensPaid', u.tokens_paid,
          'answer', a.answer
        ) order by q.sort_order, q.created_at
      )
      from public.member_questions q
      left join public.question_templates t on t.id = q.template_id
      left join public.question_unlocks u
        on u.session_id = v_s.id and u.question_id = q.id and u.viewer_id = v_uid
      left join public.member_question_answers a
        on a.question_id = q.id and v_can_read and u.id is not null
      where q.room_id = v_s.room_id and q.owner_id = v_partner_id
        and q.is_enabled and q.has_answer and (q.template_id is null or t.is_active)
    ), '[]'::jsonb),
    'endVote', case
      when v_my_end is not null then jsonb_build_object('kind', 'requested_by_me', 'at', v_my_end)
      when v_partner_end is not null then jsonb_build_object('kind', 'requested_by_partner', 'at', v_partner_end)
      else jsonb_build_object('kind', 'none')
    end,
    'transactions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', tx.id, 'roomId', tx.room_id, 'sessionId', tx.session_id, 'senderId', tx.sender_id,
          'recipientId', tx.recipient_id, 'amount', tx.amount, 'type', tx.type,
          'questionId', tx.question_id, 'createdAt', tx.created_at
        ) order by tx.created_at desc
      )
      from public.token_transactions tx
      where tx.session_id = v_s.id and (tx.sender_id = v_uid or tx.recipient_id = v_uid)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_room_admin(p_room_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settings public.room_settings;
begin
  perform private.require_owner(p_room_id, v_uid);
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;
  return jsonb_build_object(
    'room', (
      select jsonb_build_object(
        'id', r.id, 'name', r.name, 'description', r.description, 'ownerId', r.owner_id, 'status', r.status,
        'createdAt', r.created_at, 'closedAt', r.closed_at, 'purgeAt', r.purge_at
      ) from public.rooms r where r.id = p_room_id
    ),
    'settings', private.settings_json(v_settings),
    'templates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'roomId', t.room_id, 'label', t.label, 'description', t.description,
          'defaultCost', t.default_cost, 'isActive', t.is_active, 'sortOrder', t.sort_order
        ) order by t.sort_order, t.created_at
      )
      from public.question_templates t where t.room_id = p_room_id
    ), '[]'::jsonb),
    'memberCount', (select count(*) from public.room_members m where m.room_id = p_room_id)
  );
end;
$$;

-- ===============================================================
-- 모임 RPC (SECURITY DEFINER)
-- ===============================================================

create or replace function public.create_room(p_name text, p_description text, p_nickname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := left(btrim(coalesce(p_description, '')), 200);
  v_nickname text := private.validate_nickname(p_nickname);
  v_code text;
  v_room_id uuid;
  v_default_cost integer;
  v_attempt integer := 0;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    perform private.fail('VALIDATION', '모임 이름은 1~40자로 입력해 주세요.');
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := private.random_invite_code();
    begin
      insert into public.rooms (name, description, owner_id, invite_code_hash)
      values (v_name, v_description, v_uid, private.hash_invite_code(v_code))
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.room_settings (room_id) values (v_room_id)
  returning default_question_cost into v_default_cost;

  -- 예시 질문. src/lib/data/settings.ts 의 DEFAULT_QUESTION_LABELS 와 같아야 한다(테스트로 확인).
  insert into public.question_templates (room_id, label, default_cost, sort_order)
  select v_room_id, label, v_default_cost, ord - 1
  from unnest(array[
    '어떤 일을 하고 있나요?',
    '요즘 가장 몰입하는 것은 무엇인가요?',
    '남에게 말하기는 쑥스럽지만 자랑하고 싶은 것은 무엇인가요?',
    '중요하게 생각하는 가치관은 무엇인가요?',
    '요즘 좋아하는 취미나 관심사는 무엇인가요?'
  ]) with ordinality as x(label, ord);

  perform private.add_member(v_room_id, v_uid, 'owner', v_nickname);
  return jsonb_build_object('roomId', v_room_id, 'inviteCode', v_code);
end;
$$;

create or replace function public.join_room(p_invite_code text, p_nickname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_code text := private.normalize_invite_code(p_invite_code);
  v_room_id uuid;
  v_status text;
  v_nickname text;
begin
  if char_length(v_code) < 4 then
    perform private.fail('INVALID_INVITE_CODE');
  end if;
  select r.id, r.status into v_room_id, v_status
  from public.rooms r where r.invite_code_hash = private.hash_invite_code(v_code)
  for share;
  if v_room_id is null then
    perform private.fail('INVALID_INVITE_CODE');
  end if;
  if v_status <> 'active' then
    perform private.fail('ROOM_CLOSED');
  end if;

  -- 이미 가입한 사용자는 초기 토큰을 다시 받지 않는다.
  if exists (select 1 from public.room_members m where m.room_id = v_room_id and m.user_id = v_uid) then
    return jsonb_build_object('roomId', v_room_id, 'alreadyMember', true);
  end if;

  v_nickname := private.validate_nickname(p_nickname);
  begin
    perform private.add_member(v_room_id, v_uid, 'participant', v_nickname);
  exception when unique_violation then
    -- 같은 사용자의 동시 가입 요청: 먼저 끝난 쪽만 반영되고 이쪽 변경은 이 블록에서 모두 롤백된다.
    return jsonb_build_object('roomId', v_room_id, 'alreadyMember', true);
  end;
  return jsonb_build_object('roomId', v_room_id, 'alreadyMember', false);
end;
$$;

-- ===============================================================
-- 프로필 RPC (SECURITY DEFINER)
-- ===============================================================

-- p_questions: [{ "id": uuid, "answer": text, "tokenCost": int, "isEnabled": bool }, ...]
create or replace function public.update_profile(p_room_id uuid, p_nickname text, p_questions jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_nickname text;
  v_settings public.room_settings;
  v_item jsonb;
  v_question_id uuid;
  v_answer text;
  v_cost integer;
  v_enabled boolean;
begin
  perform private.require_member(p_room_id, v_uid);
  perform private.require_active_room(p_room_id);
  v_nickname := private.validate_nickname(p_nickname);
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;

  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) > 50 then
    perform private.fail('VALIDATION');
  end if;

  update public.room_members m set nickname = v_nickname where m.room_id = p_room_id and m.user_id = v_uid;

  for v_item in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_item -> 'tokenCost') <> 'number'
       or jsonb_typeof(v_item -> 'isEnabled') <> 'boolean'
       or jsonb_typeof(v_item -> 'answer') <> 'string'
       or (v_item ->> 'tokenCost')::numeric <> trunc((v_item ->> 'tokenCost')::numeric) then
      perform private.fail('VALIDATION');
    end if;
    v_question_id := (v_item ->> 'id')::uuid;
    v_cost := (v_item ->> 'tokenCost')::integer;
    v_enabled := (v_item ->> 'isEnabled')::boolean;
    v_answer := btrim(v_item ->> 'answer');

    -- 본인 질문만 수정할 수 있다. 행을 잠가 진행 중인 열람 결제와 직렬화한다.
    perform 1 from public.member_questions q
    where q.id = v_question_id and q.room_id = p_room_id and q.owner_id = v_uid
    for update;
    if not found then
      perform private.fail('FORBIDDEN');
    end if;
    if v_cost < v_settings.min_question_cost or v_cost > v_settings.max_question_cost then
      perform private.fail('VALIDATION',
        format('열람 비용은 %s~%s 토큰 사이로 설정해 주세요.', v_settings.min_question_cost, v_settings.max_question_cost));
    end if;
    if char_length(v_answer) > 1000 then
      perform private.fail('VALIDATION', '답변은 1000자 이하로 입력해 주세요.');
    end if;

    update public.member_questions q
    set token_cost = v_cost, is_enabled = v_enabled, has_answer = char_length(v_answer) > 0
    where q.id = v_question_id;

    if char_length(v_answer) = 0 then
      delete from public.member_question_answers a where a.question_id = v_question_id;
    else
      insert into public.member_question_answers (question_id, owner_id, answer)
      values (v_question_id, v_uid, v_answer)
      on conflict (question_id) do update set answer = excluded.answer;
    end if;
  end loop;
end;
$$;

create or replace function public.add_custom_question(p_room_id uuid, p_label text, p_token_cost integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settings public.room_settings;
  v_label text;
  v_id uuid;
begin
  perform private.require_member(p_room_id, v_uid);
  perform private.require_active_room(p_room_id);
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;
  if not v_settings.custom_questions_enabled then
    perform private.fail('CUSTOM_QUESTIONS_DISABLED');
  end if;
  v_label := private.validate_label(p_label);
  if p_token_cost is null or p_token_cost < v_settings.min_question_cost or p_token_cost > v_settings.max_question_cost then
    perform private.fail('VALIDATION');
  end if;
  insert into public.member_questions (room_id, owner_id, template_id, label_snapshot, token_cost, sort_order)
  values (
    p_room_id, v_uid, null, v_label, p_token_cost,
    coalesce((select max(q.sort_order) from public.member_questions q where q.room_id = p_room_id and q.owner_id = v_uid), -1) + 1
  )
  returning id into v_id;
  return jsonb_build_object('questionId', v_id);
end;
$$;

create or replace function public.delete_custom_question(p_room_id uuid, p_question_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_template_id uuid;
begin
  perform private.require_member(p_room_id, v_uid);
  select q.template_id into v_template_id from public.member_questions q
  where q.id = p_question_id and q.room_id = p_room_id and q.owner_id = v_uid
  for update;
  if not found then
    perform private.fail('FORBIDDEN');
  end if;
  if v_template_id is not null then
    perform private.fail('INVALID_STATE', '모임 기본 질문은 삭제할 수 없습니다. 비공개로 설정해 주세요.');
  end if;
  delete from public.member_questions q where q.id = p_question_id;
end;
$$;

-- ===============================================================
-- 독대 RPC (SECURITY DEFINER)
-- ===============================================================

create or replace function public.request_session(p_room_id uuid, p_recipient_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settings public.room_settings;
  v_id uuid;
begin
  perform private.require_member(p_room_id, v_uid);
  perform private.require_active_room(p_room_id);
  if p_recipient_id = v_uid then
    perform private.fail('SELF_ACTION');
  end if;
  if not exists (select 1 from public.room_members m where m.room_id = p_room_id and m.user_id = p_recipient_id) then
    perform private.fail('NOT_FOUND');
  end if;
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;
  -- 참여자 목록이 비공개면 운영자이거나 이미 독대한 상대에게만 요청할 수 있다(room_members 정책과 같은 기준).
  -- 다른 경로로 알아낸 ID로 요청하는 것을 막고, 존재 여부도 알려주지 않는다.
  if not (v_settings.member_list_visible
          or private.is_room_owner(p_room_id)
          or private.shares_session(p_room_id, p_recipient_id)) then
    perform private.fail('NOT_FOUND');
  end if;

  perform private.lock_members(p_room_id, v_uid, p_recipient_id);
  perform private.expire_stale_sessions(p_room_id);

  if exists (
    select 1 from public.pair_sessions s
    where s.room_id = p_room_id and s.status in ('pending', 'active')
      and ((s.requester_id = v_uid and s.recipient_id = p_recipient_id) or (s.requester_id = p_recipient_id and s.recipient_id = v_uid))
  ) then
    perform private.fail('SESSION_DUPLICATE');
  end if;
  if private.active_session_count(p_room_id, v_uid) >= v_settings.max_active_sessions_per_member then
    perform private.fail('SESSION_LIMIT');
  end if;

  begin
    insert into public.pair_sessions (room_id, requester_id, recipient_id, expires_at)
    values (p_room_id, v_uid, p_recipient_id, now() + make_interval(mins => v_settings.request_expiry_minutes))
    returning id into v_id;
  exception when unique_violation then
    perform private.fail('SESSION_DUPLICATE');
  end;
  return jsonb_build_object('sessionId', v_id);
end;
$$;

create or replace function public.respond_to_session(p_session_id uuid, p_accept boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_s public.pair_sessions;
  v_max integer;
begin
  select * into v_s from public.pair_sessions s where s.id = p_session_id for update;
  if not found or (v_s.requester_id <> v_uid and v_s.recipient_id <> v_uid) then
    perform private.fail('NOT_FOUND');
  end if;
  if v_s.recipient_id <> v_uid then
    perform private.fail('FORBIDDEN');
  end if;
  if v_s.status <> 'pending' then
    perform private.fail('INVALID_STATE');
  end if;
  if v_s.expires_at <= now() then
    perform private.fail('SESSION_EXPIRED');
  end if;
  perform private.require_active_room(v_s.room_id);

  if not coalesce(p_accept, false) then
    update public.pair_sessions s set status = 'rejected', closed_at = now() where s.id = p_session_id;
    perform private.finish_session(p_session_id);
    return;
  end if;

  perform private.lock_members(v_s.room_id, v_s.requester_id, v_s.recipient_id);
  select st.max_active_sessions_per_member into v_max from public.room_settings st where st.room_id = v_s.room_id;
  if private.active_session_count(v_s.room_id, v_s.requester_id) >= v_max
     or private.active_session_count(v_s.room_id, v_s.recipient_id) >= v_max then
    perform private.fail('SESSION_LIMIT');
  end if;
  update public.pair_sessions s set status = 'active', accepted_at = now() where s.id = p_session_id;
end;
$$;

create or replace function public.cancel_session_request(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_s public.pair_sessions;
begin
  select * into v_s from public.pair_sessions s where s.id = p_session_id for update;
  if not found or (v_s.requester_id <> v_uid and v_s.recipient_id <> v_uid) then
    perform private.fail('NOT_FOUND');
  end if;
  if v_s.requester_id <> v_uid then
    perform private.fail('FORBIDDEN');
  end if;
  if v_s.status <> 'pending' then
    perform private.fail('INVALID_STATE');
  end if;
  update public.pair_sessions s set status = 'cancelled', closed_at = now() where s.id = p_session_id;
  perform private.finish_session(p_session_id);
end;
$$;

-- 거래 가능한 독대를 잠그고 반환한다: 당사자, 활성 모임, active 상태, 종료 요청 없음.
create or replace function private.lock_tradable_session(p_session_id uuid, p_uid uuid)
returns public.pair_sessions
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_s public.pair_sessions;
begin
  select * into v_s from public.pair_sessions s where s.id = p_session_id for update;
  if not found or (v_s.requester_id <> p_uid and v_s.recipient_id <> p_uid) then
    perform private.fail('NOT_FOUND');
  end if;
  perform private.require_active_room(v_s.room_id);
  if v_s.status <> 'active' then
    perform private.fail('SESSION_NOT_ACTIVE');
  end if;
  if v_s.requester_end_at is not null or v_s.recipient_end_at is not null then
    perform private.fail('SESSION_ENDING');
  end if;
  return v_s;
end;
$$;

-- 두 지갑을 user_id 순서로 잠근다(교착 방지).
create or replace function private.lock_wallets(p_room_id uuid, p_a uuid, p_b uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform 1 from public.wallets w
  where w.room_id = p_room_id and w.user_id in (p_a, p_b)
  order by w.user_id
  for update;
end;
$$;

create or replace function public.unlock_question(p_session_id uuid, p_question_id uuid, p_expected_cost integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_s public.pair_sessions := private.lock_tradable_session(p_session_id, v_uid);
  v_partner uuid := case when v_s.requester_id = v_uid then v_s.recipient_id else v_s.requester_id end;
  v_q public.member_questions;
  v_balance integer;
begin
  -- 질문 행을 공유 잠금해 결제 도중 비용이 바뀌지 않게 한다.
  select * into v_q from public.member_questions q where q.id = p_question_id for share;
  if not found or v_q.room_id <> v_s.room_id then
    perform private.fail('QUESTION_UNAVAILABLE');
  end if;
  if v_q.owner_id = v_uid then
    perform private.fail('SELF_ACTION');
  end if;
  if v_q.owner_id <> v_partner or not private.is_public_question(v_q.id) then
    perform private.fail('QUESTION_UNAVAILABLE');
  end if;

  -- 이미 이 독대에서 연 질문이면 다시 청구하지 않는다.
  if exists (
    select 1 from public.question_unlocks u
    where u.session_id = p_session_id and u.question_id = p_question_id and u.viewer_id = v_uid
  ) then
    select w.balance into v_balance from public.wallets w where w.room_id = v_s.room_id and w.user_id = v_uid;
    return jsonb_build_object('alreadyUnlocked', true, 'balance', v_balance);
  end if;

  -- 사용자가 확인한 비용과 현재 비용이 다르면 거절(과거 결제는 소급하지 않고, 새 열람은 현재 비용).
  if p_expected_cost is null or p_expected_cost <> v_q.token_cost then
    perform private.fail('PRICE_CHANGED');
  end if;

  perform private.lock_wallets(v_s.room_id, v_uid, v_partner);
  select w.balance into v_balance from public.wallets w where w.room_id = v_s.room_id and w.user_id = v_uid;
  if v_balance is null then
    perform private.fail('NOT_FOUND');
  end if;
  if v_balance < v_q.token_cost then
    perform private.fail('INSUFFICIENT_BALANCE');
  end if;

  if v_q.token_cost > 0 then
    update public.wallets w set balance = w.balance - v_q.token_cost
    where w.room_id = v_s.room_id and w.user_id = v_uid;
    update public.wallets w set balance = w.balance + v_q.token_cost
    where w.room_id = v_s.room_id and w.user_id = v_partner;
    insert into public.token_transactions (room_id, session_id, sender_id, recipient_id, amount, type, question_id)
    values (v_s.room_id, p_session_id, v_uid, v_partner, v_q.token_cost, 'unlock_payment', p_question_id);
  end if;

  insert into public.question_unlocks (session_id, room_id, question_id, viewer_id, owner_id, tokens_paid)
  values (p_session_id, v_s.room_id, p_question_id, v_uid, v_partner, v_q.token_cost);

  return jsonb_build_object('alreadyUnlocked', false, 'balance', v_balance - v_q.token_cost);
end;
$$;

create or replace function public.send_gift(p_session_id uuid, p_amount integer, p_request_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_s public.pair_sessions := private.lock_tradable_session(p_session_id, v_uid);
  v_partner uuid := case when v_s.requester_id = v_uid then v_s.recipient_id else v_s.requester_id end;
  v_settings public.room_settings;
  v_key text := btrim(coalesce(p_request_id, ''));
  v_balance integer;
begin
  select * into v_settings from public.room_settings st where st.room_id = v_s.room_id;
  if not v_settings.gifts_enabled then
    perform private.fail('GIFTS_DISABLED');
  end if;
  if char_length(v_key) < 8 or char_length(v_key) > 100 then
    perform private.fail('VALIDATION');
  end if;

  perform private.lock_wallets(v_s.room_id, v_uid, v_partner);
  select w.balance into v_balance from public.wallets w where w.room_id = v_s.room_id and w.user_id = v_uid;

  -- 같은 요청 ID는 한 번만 처리한다.
  if exists (
    select 1 from public.token_transactions tx
    where tx.room_id = v_s.room_id and tx.sender_id = v_uid and tx.idempotency_key = v_key
  ) then
    return jsonb_build_object('duplicate', true, 'balance', v_balance);
  end if;

  if p_amount is null or p_amount < v_settings.gift_min_amount or p_amount > v_settings.gift_max_amount then
    perform private.fail('VALIDATION',
      format('보낼 수 있는 토큰은 %s~%s개입니다.', v_settings.gift_min_amount, v_settings.gift_max_amount));
  end if;
  if v_balance is null or v_balance < p_amount then
    perform private.fail('INSUFFICIENT_BALANCE');
  end if;

  begin
    update public.wallets w set balance = w.balance - p_amount where w.room_id = v_s.room_id and w.user_id = v_uid;
    update public.wallets w set balance = w.balance + p_amount where w.room_id = v_s.room_id and w.user_id = v_partner;
    insert into public.token_transactions (room_id, session_id, sender_id, recipient_id, amount, type, idempotency_key)
    values (v_s.room_id, p_session_id, v_uid, v_partner, p_amount, 'gift', v_key);
  exception when unique_violation then
    -- 다른 독대에서 같은 키가 동시에 쓰인 경우: 이 블록의 잔액 변경은 롤백되고 중복으로 처리한다.
    select w.balance into v_balance from public.wallets w where w.room_id = v_s.room_id and w.user_id = v_uid;
    return jsonb_build_object('duplicate', true, 'balance', v_balance);
  end;

  return jsonb_build_object('duplicate', false, 'balance', v_balance - p_amount);
end;
$$;

create or replace function public.vote_end_session(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_s public.pair_sessions;
begin
  select * into v_s from public.pair_sessions s where s.id = p_session_id for update;
  if not found or (v_s.requester_id <> v_uid and v_s.recipient_id <> v_uid) then
    perform private.fail('NOT_FOUND');
  end if;
  if v_s.status <> 'active' then
    perform private.fail('SESSION_NOT_ACTIVE');
  end if;

  update public.pair_sessions s set
    requester_end_at = case when s.requester_id = v_uid then coalesce(s.requester_end_at, now()) else s.requester_end_at end,
    recipient_end_at = case when s.recipient_id = v_uid then coalesce(s.recipient_end_at, now()) else s.recipient_end_at end
  where s.id = p_session_id
  returning * into v_s;

  -- 양쪽이 모두 동의했을 때만 종료를 확정한다. 확정 즉시 RLS상 열람 권한이 사라진다.
  if v_s.requester_end_at is not null and v_s.recipient_end_at is not null then
    update public.pair_sessions s set status = 'closed', closed_at = now() where s.id = p_session_id;
    perform private.finish_session(p_session_id);
    return jsonb_build_object('closed', true, 'roomId', v_s.room_id);
  end if;
  return jsonb_build_object('closed', false, 'roomId', v_s.room_id);
end;
$$;

create or replace function public.cancel_end_vote(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_s public.pair_sessions;
begin
  select * into v_s from public.pair_sessions s where s.id = p_session_id for update;
  if not found or (v_s.requester_id <> v_uid and v_s.recipient_id <> v_uid) then
    perform private.fail('NOT_FOUND');
  end if;
  if v_s.status <> 'active' then
    perform private.fail('SESSION_NOT_ACTIVE');
  end if;
  update public.pair_sessions s set requester_end_at = null, recipient_end_at = null where s.id = p_session_id;
end;
$$;

-- ===============================================================
-- 운영자 RPC (SECURITY DEFINER)
-- ===============================================================

create or replace function public.update_room_info(p_room_id uuid, p_name text, p_description text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_owner(p_room_id, v_uid);
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    perform private.fail('VALIDATION', '모임 이름은 1~40자로 입력해 주세요.');
  end if;
  update public.rooms r set name = v_name, description = left(btrim(coalesce(p_description, '')), 200)
  where r.id = p_room_id;
end;
$$;

-- p_settings: RoomSettings(camelCase) JSON. 범위는 테이블 CHECK 제약이 최종 강제한다.
create or replace function public.update_room_settings(p_room_id uuid, p_settings jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_new public.room_settings;
begin
  perform private.require_owner(p_room_id, v_uid);
  if jsonb_typeof(p_settings) is distinct from 'object' then
    perform private.fail('VALIDATION');
  end if;

  update public.room_settings s set
    initial_tokens = (p_settings ->> 'initialTokens')::integer,
    default_question_cost = (p_settings ->> 'defaultQuestionCost')::integer,
    min_question_cost = (p_settings ->> 'minQuestionCost')::integer,
    max_question_cost = (p_settings ->> 'maxQuestionCost')::integer,
    gifts_enabled = (p_settings ->> 'giftsEnabled')::boolean,
    gift_default_amount = (p_settings ->> 'giftDefaultAmount')::integer,
    gift_min_amount = (p_settings ->> 'giftMinAmount')::integer,
    gift_max_amount = (p_settings ->> 'giftMaxAmount')::integer,
    custom_questions_enabled = (p_settings ->> 'customQuestionsEnabled')::boolean,
    max_active_sessions_per_member = (p_settings ->> 'maxActiveSessionsPerMember')::integer,
    request_expiry_minutes = (p_settings ->> 'requestExpiryMinutes')::integer,
    session_retention_days = (p_settings ->> 'sessionRetentionDays')::integer,
    room_retention_days = (p_settings ->> 'roomRetentionDays')::integer,
    member_list_visible = (p_settings ->> 'memberListVisible')::boolean
  where s.room_id = p_room_id
  returning * into v_new;

  -- 새 범위를 벗어난 기존 비용은 범위 안으로 맞춘다(이미 결제된 열람에는 영향 없음).
  update public.member_questions q
  set token_cost = least(greatest(q.token_cost, v_new.min_question_cost), v_new.max_question_cost)
  where q.room_id = p_room_id
    and (q.token_cost < v_new.min_question_cost or q.token_cost > v_new.max_question_cost);
  update public.question_templates t
  set default_cost = least(greatest(t.default_cost, v_new.min_question_cost), v_new.max_question_cost)
  where t.room_id = p_room_id
    and (t.default_cost < v_new.min_question_cost or t.default_cost > v_new.max_question_cost);
end;
$$;

create or replace function public.regenerate_invite_code(p_room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_code text;
  v_attempt integer := 0;
begin
  perform private.require_owner(p_room_id, v_uid);
  perform private.require_active_room(p_room_id);
  loop
    v_attempt := v_attempt + 1;
    v_code := private.random_invite_code();
    begin
      update public.rooms r set invite_code_hash = private.hash_invite_code(v_code) where r.id = p_room_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;
  return jsonb_build_object('inviteCode', v_code);
end;
$$;

create or replace function public.upsert_question_template(
  p_room_id uuid,
  p_id uuid,
  p_label text,
  p_description text,
  p_default_cost integer,
  p_is_active boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_settings public.room_settings;
  v_label text;
  v_description text := left(btrim(coalesce(p_description, '')), 200);
  v_template public.question_templates;
begin
  perform private.require_owner(p_room_id, v_uid);
  select * into v_settings from public.room_settings s where s.room_id = p_room_id;
  v_label := private.validate_label(p_label);
  if p_default_cost is null or p_default_cost < v_settings.min_question_cost or p_default_cost > v_settings.max_question_cost then
    perform private.fail('VALIDATION',
      format('기본 비용은 %s~%s 토큰 사이여야 합니다.', v_settings.min_question_cost, v_settings.max_question_cost));
  end if;

  if p_id is not null then
    update public.question_templates t
    set label = v_label, description = v_description, default_cost = p_default_cost, is_active = coalesce(p_is_active, true)
    where t.id = p_id and t.room_id = p_room_id
    returning * into v_template;
    if not found then
      perform private.fail('NOT_FOUND');
    end if;
    update public.member_questions q set label_snapshot = v_label where q.template_id = p_id;
    return;
  end if;

  insert into public.question_templates (room_id, label, description, default_cost, is_active, sort_order)
  values (
    p_room_id, v_label, v_description, p_default_cost, coalesce(p_is_active, true),
    coalesce((select max(t.sort_order) from public.question_templates t where t.room_id = p_room_id), -1) + 1
  )
  returning * into v_template;

  -- 기존 참여자 모두에게 새 질문을 만들어 준다(답변 전에는 다른 사람에게 보이지 않음).
  insert into public.member_questions (room_id, owner_id, template_id, label_snapshot, token_cost, sort_order)
  select p_room_id, m.user_id, v_template.id, v_template.label, v_template.default_cost, v_template.sort_order
  from public.room_members m where m.room_id = p_room_id;
end;
$$;

create or replace function public.delete_question_template(p_room_id uuid, p_template_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.require_owner(p_room_id, v_uid);
  -- 참여자 질문·답변·열람 기록은 ON DELETE CASCADE로 함께 삭제된다.
  delete from public.question_templates t where t.id = p_template_id and t.room_id = p_room_id;
  if not found then
    perform private.fail('NOT_FOUND');
  end if;
end;
$$;

create or replace function public.move_question_template(p_room_id uuid, p_template_id uuid, p_direction text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_ids uuid[];
  v_index integer;
  v_target integer;
  v_tmp uuid;
  i integer;
begin
  perform private.require_owner(p_room_id, v_uid);
  if p_direction not in ('up', 'down') then
    perform private.fail('VALIDATION');
  end if;
  select array_agg(t.id order by t.sort_order, t.created_at) into v_ids
  from (select * from public.question_templates where room_id = p_room_id for update) t;
  v_index := array_position(v_ids, p_template_id);
  if v_index is null then
    perform private.fail('NOT_FOUND');
  end if;
  v_target := case when p_direction = 'up' then v_index - 1 else v_index + 1 end;
  if v_target < 1 or v_target > array_length(v_ids, 1) then
    return;
  end if;
  v_tmp := v_ids[v_index];
  v_ids[v_index] := v_ids[v_target];
  v_ids[v_target] := v_tmp;
  for i in 1..array_length(v_ids, 1) loop
    update public.question_templates t set sort_order = i - 1 where t.id = v_ids[i];
    update public.member_questions q set sort_order = i - 1 where q.template_id = v_ids[i];
  end loop;
end;
$$;

create or replace function public.close_room(p_room_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_status text;
  v_days integer;
begin
  perform private.require_owner(p_room_id, v_uid);
  select r.status into v_status from public.rooms r where r.id = p_room_id for update;
  if v_status = 'closed' then
    return;
  end if;
  update public.pair_sessions s
  set status = case when s.status = 'pending' then 'cancelled' else 'closed' end,
      closed_at = coalesce(s.closed_at, now())
  where s.room_id = p_room_id and s.status in ('pending', 'active');

  select st.room_retention_days into v_days from public.room_settings st where st.room_id = p_room_id;
  if coalesce(v_days, 0) = 0 then
    -- 프로필·답변·지갑·질문·독대·거래 기록 모두 ON DELETE CASCADE로 삭제된다.
    delete from public.rooms r where r.id = p_room_id;
  else
    update public.rooms r set status = 'closed', closed_at = now(), purge_at = now() + make_interval(days => v_days)
    where r.id = p_room_id;
  end if;
end;
$$;

-- ===============================================================
-- 예약 정리 (service_role 전용 — Cron API에서 호출). 재실행해도 안전하다.
-- ===============================================================
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_expired integer;
  v_sessions integer;
  v_rooms integer;
begin
  v_expired := private.expire_stale_sessions(null);
  delete from public.pair_sessions s where s.purge_at is not null and s.purge_at <= now();
  get diagnostics v_sessions = row_count;
  delete from public.rooms r where r.status = 'closed' and r.purge_at is not null and r.purge_at <= now();
  get diagnostics v_rooms = row_count;
  return jsonb_build_object('expiredRequests', v_expired, 'purgedSessions', v_sessions, 'purgedRooms', v_rooms);
end;
$$;

-- ===============================================================
-- 실행 권한 (최소 권한)
-- ===============================================================
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- 조회
grant execute on function public.list_my_rooms() to authenticated;
grant execute on function public.get_room_dashboard(uuid) to authenticated;
grant execute on function public.get_profile_editor(uuid) to authenticated;
grant execute on function public.get_member_profile(uuid, uuid) to authenticated;
grant execute on function public.get_session_view(uuid) to authenticated;
grant execute on function public.get_room_admin(uuid) to authenticated;
-- 변경
grant execute on function public.create_room(text, text, text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.update_profile(uuid, text, jsonb) to authenticated;
grant execute on function public.add_custom_question(uuid, text, integer) to authenticated;
grant execute on function public.delete_custom_question(uuid, uuid) to authenticated;
grant execute on function public.request_session(uuid, uuid) to authenticated;
grant execute on function public.respond_to_session(uuid, boolean) to authenticated;
grant execute on function public.cancel_session_request(uuid) to authenticated;
grant execute on function public.unlock_question(uuid, uuid, integer) to authenticated;
grant execute on function public.send_gift(uuid, integer, text) to authenticated;
grant execute on function public.vote_end_session(uuid) to authenticated;
grant execute on function public.cancel_end_vote(uuid) to authenticated;
grant execute on function public.update_room_info(uuid, text, text) to authenticated;
grant execute on function public.update_room_settings(uuid, jsonb) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.upsert_question_template(uuid, uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.delete_question_template(uuid, uuid) to authenticated;
grant execute on function public.move_question_template(uuid, uuid, text) to authenticated;
grant execute on function public.close_room(uuid) to authenticated;
-- 정리 작업은 service_role만
revoke all on function public.run_maintenance() from authenticated;
grant execute on function public.run_maintenance() to service_role;

-- RLS 정책과 조회 함수(호출자 권한 실행)에 필요한 private 헬퍼만 authenticated에 연다.
-- 상태를 바꾸는 private 헬퍼(add_member, finish_session, lock_* 등)는 열지 않는다.
grant execute on function private.is_room_member(uuid) to authenticated;
grant execute on function private.is_room_owner(uuid) to authenticated;
grant execute on function private.member_list_visible(uuid) to authenticated;
grant execute on function private.shares_session(uuid, uuid) to authenticated;
grant execute on function private.can_read_answer(uuid) to authenticated;
grant execute on function private.is_public_question(uuid) to authenticated;
grant execute on function private.fail(text, text) to authenticated;
grant execute on function private.require_uid() to authenticated;
grant execute on function private.require_member(uuid, uuid) to authenticated;
grant execute on function private.require_owner(uuid, uuid) to authenticated;
grant execute on function private.effective_status(text, timestamptz) to authenticated;
grant execute on function private.active_session_count(uuid, uuid) to authenticated;
grant execute on function private.member_json(public.room_members) to authenticated;
grant execute on function private.settings_json(public.room_settings) to authenticated;
grant execute on function private.question_meta_json(public.member_questions) to authenticated;
grant execute on function private.session_json(public.pair_sessions) to authenticated;
grant execute on function private.session_summary(public.pair_sessions, uuid) to authenticated;
