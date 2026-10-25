-- 독대 라이트: 항목 제목과 기본 항목(기본 질문 5개).
--  * dd_items 에 제목(title)을 별도 필드로 추가한다.
--  * 기본 질문(dd_questions kind='default')은 모든 참가자에게 "기본 항목" 슬롯으로 항상 표시된다.
--    슬롯의 제목·질문 문구는 관리자가 편집하는 dd_questions 를 그대로 따른다.
--    참가자가 내용을 쓰면 dd_items 행(question_id 로 연결)이 만들어진다. 쓰기 전에는 행이 없고(상대에게 보이지 않음) 슬롯만 보인다.
--  * 항목 한도(max_items=10)는 활성 기본 질문 수를 포함한다(기본 5 + 직접 추가 최대 5).
--  * 열람 스냅샷에 제목·질문 문구를 함께 저장하고, 독대 종료 시 내용과 함께 비운다.
-- 기존 항목·거래·열람 데이터는 삭제하거나 바꾸지 않는다(컬럼 추가와 함수 교체뿐).

alter table public.dd_items add column title text not null default '' check (char_length(title) <= 60);
alter table public.dd_items add column question_id uuid references public.dd_questions (id) on delete set null;
create unique index dd_items_participant_question_key on public.dd_items (participant_id, question_id) where question_id is not null;

alter table public.dd_unlocks add column snapshot_title text check (char_length(snapshot_title) <= 60);
alter table public.dd_unlocks add column snapshot_prompt text check (char_length(snapshot_prompt) <= 300);

-- 서명이 바뀌는 항목 추가·수정 함수는 이전 서명을 제거하고 새로 만든다(이 파일에서 만든 함수만 대상).
drop function public.dd_api_add_item(uuid, text, text, text, integer);
drop function public.dd_api_update_item(uuid, text, uuid, text, text, integer);
drop function public.dd_add_item(uuid, text, text, integer);
drop function public.dd_update_item(uuid, uuid, text, text, integer);

-- 항목별 열람 현황(소유자용). 닉네임·시각·지불액·확정된 보상만 담는다.
create function public.dd_item_opens(p_item uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'unlock_id', u.id, 'viewer_nickname', v.nickname, 'opened_at', u.created_at, 'tokens_paid', u.tokens_paid,
    'reward_confirmed', u.reward_confirmed_at is not null,
    'reward_amount', case when u.reward_confirmed_at is not null then u.reward_amount end
  ) order by u.created_at), '[]'::jsonb)
  from public.dd_unlocks u join public.dd_participants v on v.id = u.viewer_id
  where u.item_id = p_item
$$;

-- 내 항목: 기본 항목 슬롯(항상 표시) + 직접 추가한 항목
create or replace function public.dd_my_items(p_participant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_defaults integer := (select count(*) from public.dd_questions where kind = 'default' and is_active);
begin
  return jsonb_build_object(
    'max_items', public.dd_setting('max_items', 10),
    'custom_limit', greatest(public.dd_setting('max_items', 10) - v_defaults, 0),
    'cost_min', public.dd_setting('item_cost_min', 1),
    'cost_max', public.dd_setting('item_cost_max', 3),
    'reward_max', public.dd_setting('reward_max', 5),
    'defaults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'title', q.title, 'prompt', q.body, 'hint', q.hint,
        'item', (select jsonb_build_object('id', i.id, 'body', i.body, 'cost', i.cost, 'opens', public.dd_item_opens(i.id))
                 from public.dd_items i where i.participant_id = me.id and i.question_id = q.id)
      ) order by q.position, q.created_at)
      from public.dd_questions q where q.kind = 'default' and q.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'title', i.title, 'body', i.body, 'cost', i.cost, 'opens', public.dd_item_opens(i.id)
      ) order by i.position, i.created_at)
      from public.dd_items i where i.participant_id = me.id and i.question_id is null
    ), '[]'::jsonb),
    'removed_opens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unlock_id', u.id, 'viewer_nickname', v.nickname, 'opened_at', u.created_at, 'tokens_paid', u.tokens_paid,
        'reward_confirmed', u.reward_confirmed_at is not null,
        'reward_amount', case when u.reward_confirmed_at is not null then u.reward_amount end
      ) order by u.created_at)
      from public.dd_unlocks u join public.dd_participants v on v.id = u.viewer_id
      where u.owner_id = me.id and u.item_id is null
    ), '[]'::jsonb)
  );
end;
$$;

-- 직접 추가하는 항목(제목 + 유형 + 내용 + 비용). 한도는 활성 기본 질문 수를 포함한다.
create function public.dd_add_item(p_participant uuid, p_kind text, p_title text, p_body text, p_cost integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if p_kind not in ('tell', 'ask') or char_length(v_title) not between 1 and 60 or char_length(v_body) not between 1 and 500
     or p_cost is null or p_cost < public.dd_setting('item_cost_min', 1) or p_cost > public.dd_setting('item_cost_max', 3) then
    perform public.dd_fail('VALIDATION');
  end if;
  perform 1 from public.dd_participants where id = me.id for update;
  if (select count(*) from public.dd_items where participant_id = me.id and question_id is null)
     + (select count(*) from public.dd_questions where kind = 'default' and is_active) >= public.dd_setting('max_items', 10) then
    perform public.dd_fail('ITEM_LIMIT');
  end if;
  insert into public.dd_items (participant_id, kind, title, body, cost, position)
    values (me.id, p_kind, v_title, v_body, p_cost,
            greatest(coalesce((select max(position) from public.dd_items where participant_id = me.id), 0), 100) + 1)
    returning id into v_id;
  return v_id;
end;
$$;

-- 직접 추가한 항목 수정. 이미 열람된 항목은 유형·제목·내용을 바꿀 수 없고 비용만 바꿀 수 있다.
create function public.dd_update_item(p_participant uuid, p_item uuid, p_kind text, p_title text, p_body text, p_cost integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_item public.dd_items;
begin
  if p_kind not in ('tell', 'ask') or char_length(v_title) not between 1 and 60 or char_length(v_body) not between 1 and 500
     or p_cost is null or p_cost < public.dd_setting('item_cost_min', 1) or p_cost > public.dd_setting('item_cost_max', 3) then
    perform public.dd_fail('VALIDATION');
  end if;
  select * into v_item from public.dd_items where id = p_item and participant_id = me.id and question_id is null for update;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if (v_item.kind <> p_kind or v_item.title <> v_title or v_item.body <> v_body)
     and exists (select 1 from public.dd_unlocks where item_id = v_item.id) then
    perform public.dd_fail('ITEM_LOCKED');
  end if;
  update public.dd_items set kind = p_kind, title = v_title, body = v_body, cost = p_cost where id = v_item.id;
end;
$$;

-- 기본 항목 작성·수정(유형은 항상 tell). 내용을 지우려면 dd_delete_item 을 쓴다(슬롯은 사라지지 않는다).
create function public.dd_save_default_item(p_participant uuid, p_question uuid, p_body text, p_cost integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_body text := btrim(coalesce(p_body, ''));
  v_q public.dd_questions;
  v_item public.dd_items;
  v_id uuid;
begin
  if char_length(v_body) not between 1 and 500
     or p_cost is null or p_cost < public.dd_setting('item_cost_min', 1) or p_cost > public.dd_setting('item_cost_max', 3) then
    perform public.dd_fail('VALIDATION');
  end if;
  select * into v_q from public.dd_questions where id = p_question and kind = 'default' and is_active;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  perform 1 from public.dd_participants where id = me.id for update;
  select * into v_item from public.dd_items where participant_id = me.id and question_id = v_q.id for update;
  if found then
    if v_item.body <> v_body and exists (select 1 from public.dd_unlocks where item_id = v_item.id) then
      perform public.dd_fail('ITEM_LOCKED');
    end if;
    update public.dd_items set body = v_body, cost = p_cost where id = v_item.id;
    return v_item.id;
  end if;
  insert into public.dd_items (participant_id, kind, title, body, cost, position, question_id)
    values (me.id, 'tell', '', v_body, p_cost, v_q.position, v_q.id) returning id into v_id;
  return v_id;
end;
$$;

-- 열람(결제): 스냅샷에 제목·질문 문구를 함께 저장한다. 나머지 규칙(잠금 순서, 중복 방지, 비용 확인)은 그대로다.
create or replace function public.dd_unlock_item(p_participant uuid, p_pair uuid, p_item uuid, p_expected_cost integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_pairs;
  v_owner uuid;
  v_item public.dd_items;
  v_unlock public.dd_unlocks;
  v_balance integer;
  v_unlock_id uuid;
  v_title text;
  v_prompt text;
begin
  select * into v from public.dd_pairs where id = p_pair and (a_id = me.id or b_id = me.id) for share;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v.status <> 'active' then
    perform public.dd_fail('INVALID_STATE');
  end if;
  v_owner := case when v.a_id = me.id then v.b_id else v.a_id end;

  select * into v_item from public.dd_items where id = p_item and participant_id = v_owner for share;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;

  perform 1 from public.dd_wallets where participant_id in (me.id, v_owner) order by participant_id for update;

  select * into v_unlock from public.dd_unlocks where pair_id = v.id and item_id = v_item.id and viewer_id = me.id;
  if found then
    select balance into v_balance from public.dd_wallets where participant_id = me.id;
    return jsonb_build_object('already_unlocked', true, 'unlock_id', v_unlock.id, 'balance', v_balance,
                              'kind', v_unlock.snapshot_kind, 'title', v_unlock.snapshot_title,
                              'prompt', v_unlock.snapshot_prompt, 'body', v_unlock.snapshot_body);
  end if;

  if p_expected_cost is null or p_expected_cost <> v_item.cost then
    perform public.dd_fail('PRICE_CHANGED');
  end if;
  select balance into v_balance from public.dd_wallets where participant_id = me.id;
  if v_balance is null or v_balance < v_item.cost then
    perform public.dd_fail('INSUFFICIENT_BALANCE');
  end if;

  -- 기본 항목은 제목·질문 문구를 관리자가 편집하는 기본 질문에서 가져온다(열람 시점 값을 스냅샷으로 저장).
  if v_item.question_id is not null then
    select q.title, q.body into v_title, v_prompt from public.dd_questions q where q.id = v_item.question_id;
  else
    v_title := v_item.title;
    v_prompt := null;
  end if;

  update public.dd_wallets set balance = balance - v_item.cost where participant_id = me.id;
  update public.dd_wallets set balance = balance + v_item.cost where participant_id = v_owner;
  insert into public.dd_unlocks (pair_id, item_id, viewer_id, owner_id, tokens_paid,
                                 snapshot_kind, snapshot_body, snapshot_title, snapshot_prompt)
    values (v.id, v_item.id, me.id, v_owner, v_item.cost, v_item.kind, v_item.body, v_title, v_prompt)
    returning id into v_unlock_id;
  insert into public.dd_token_tx (room_id, pair_id, unlock_id, sender_id, recipient_id, amount, type)
    values (v.room_id, v.id, v_unlock_id, me.id, v_owner, v_item.cost, 'unlock_payment');

  return jsonb_build_object('already_unlocked', false, 'unlock_id', v_unlock_id, 'balance', v_balance - v_item.cost,
                            'kind', v_item.kind, 'title', v_title, 'prompt', v_prompt, 'body', v_item.body);
end;
$$;

-- 상대 항목(블라인드): 열람 전에는 id·순번·비용·열람 여부뿐(제목·유형·내용 없음). 열람한 건은 active 동안 스냅샷을 준다.
create or replace function public.dd_peer_items(p_participant uuid, p_pair uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_pairs;
  v_peer uuid;
begin
  select * into v from public.dd_pairs where id = p_pair and (a_id = me.id or b_id = me.id);
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  v_peer := case when v.a_id = me.id then v.b_id else v.a_id end;
  return jsonb_build_object(
    'balance', (select balance from public.dd_wallets where participant_id = me.id),
    'reward_max', public.dd_setting('reward_max', 5),
    'items', case when v.status = 'active' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'ordinal', x.ord, 'cost', x.cost, 'unlocked', x.unlocked) order by x.ord)
      from (
        select i.id, i.cost, row_number() over (order by i.position, i.created_at) as ord,
               exists (select 1 from public.dd_unlocks u where u.item_id = i.id and u.pair_id = v.id and u.viewer_id = me.id) as unlocked
        from public.dd_items i where i.participant_id = v_peer
      ) x
    ), '[]'::jsonb) else '[]'::jsonb end,
    'opened', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unlock_id', u.id,
        'kind', case when v.status = 'active' then u.snapshot_kind end,
        'title', case when v.status = 'active' then u.snapshot_title end,
        'prompt', case when v.status = 'active' then u.snapshot_prompt end,
        'body', case when v.status = 'active' then u.snapshot_body end,
        'item_deleted', u.item_id is null,
        'tokens_paid', u.tokens_paid, 'opened_at', u.created_at,
        'reward_selected', u.reward_selected, 'reward_amount', u.reward_amount,
        'reward_confirmed', u.reward_confirmed_at is not null
      ) order by u.created_at)
      from public.dd_unlocks u where u.pair_id = v.id and u.viewer_id = me.id
    ), '[]'::jsonb)
  );
end;
$$;

-- 종료 시 스냅샷(제목·질문 문구 포함)을 비운다. 열람·거래 기록은 남긴다.
create or replace function public.dd_end_pair(p_participant uuid, p_pair uuid)
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
  update public.dd_unlocks
    set snapshot_kind = null, snapshot_body = null, snapshot_title = null, snapshot_prompt = null
    where pair_id = v.id;
  return v_status;
end;
$$;

-- 공개 래퍼(anon): 방 ID + 참가자 토큰을 DB 안에서 검증한다.
create function public.dd_api_add_item(p_room uuid, p_token text, p_kind text, p_title text, p_body text, p_cost integer)
returns uuid language sql security definer set search_path = '' as $$
  select public.dd_add_item(public.dd_resolve(p_room, p_token), p_kind, p_title, p_body, p_cost)
$$;
create function public.dd_api_update_item(p_room uuid, p_token text, p_item uuid, p_kind text, p_title text, p_body text, p_cost integer)
returns void language sql security definer set search_path = '' as $$
  select public.dd_update_item(public.dd_resolve(p_room, p_token), p_item, p_kind, p_title, p_body, p_cost)
$$;
create function public.dd_api_save_default_item(p_room uuid, p_token text, p_question uuid, p_body text, p_cost integer)
returns uuid language sql security definer set search_path = '' as $$
  select public.dd_save_default_item(public.dd_resolve(p_room, p_token), p_question, p_body, p_cost)
$$;

-- 개요: 항목 사용량은 기본 항목 슬롯을 포함한다(예: 기본 5 + 직접 추가 N).
create or replace function public.dd_api_overview(p_room uuid, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.dd_resolve(p_room, p_token);
begin
  return public.dd_overview(v_me) || jsonb_build_object(
    'balance', (select balance from public.dd_wallets where participant_id = v_me),
    'items_count', (select count(*) from public.dd_items where participant_id = v_me and question_id is null)
                   + (select count(*) from public.dd_questions where kind = 'default' and is_active),
    'items_max', public.dd_setting('max_items', 10)
  );
end;
$$;

-- 권한: 내부 함수는 service_role 전용, dd_api_* 만 anon/authenticated.
revoke all on function
  public.dd_item_opens(uuid), public.dd_add_item(uuid, text, text, text, integer),
  public.dd_update_item(uuid, uuid, text, text, text, integer), public.dd_save_default_item(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function
  public.dd_item_opens(uuid), public.dd_add_item(uuid, text, text, text, integer),
  public.dd_update_item(uuid, uuid, text, text, text, integer), public.dd_save_default_item(uuid, uuid, text, integer)
  to service_role;

revoke all on function
  public.dd_api_add_item(uuid, text, text, text, text, integer),
  public.dd_api_update_item(uuid, text, uuid, text, text, text, integer),
  public.dd_api_save_default_item(uuid, text, uuid, text, integer)
  from public;
grant execute on function
  public.dd_api_add_item(uuid, text, text, text, text, integer),
  public.dd_api_update_item(uuid, text, uuid, text, text, text, integer),
  public.dd_api_save_default_item(uuid, text, uuid, text, integer)
  to anon, authenticated;
