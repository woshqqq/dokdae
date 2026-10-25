-- 독대 라이트: 토큰 시스템(지갑, 항목, 열람, 보상).
-- 추가 위주이며 기존 dd_* 데이터와 테이블을 삭제하지 않는다. 항목·지갑·열람·보상은 모두 이 파일에서 만든다.
-- 구조는 기존과 같다: 내부 함수(참가자 ID 인자, service_role 전용) + anon 공개 래퍼 dd_api_*(방 ID + 참가자 토큰 검증).

-- ---------------------------------------------------------------------------
-- 설정값(코드에 고정하지 않는다)
-- ---------------------------------------------------------------------------
insert into public.dd_settings (key, int_value) values
  ('initial_tokens', 10),
  ('max_items', 10),
  ('item_cost_min', 1),
  ('item_cost_max', 3),
  ('reward_max', 5)
on conflict (key) do nothing;
-- "최소 N개 질문" 규칙 제거: 0 이면 dd_mark_ready / 삭제 제한이 더 이상 막지 않는다.
update public.dd_settings set int_value = 0 where key = 'min_questions';

create function public.dd_setting(p_key text, p_default integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce((select int_value from public.dd_settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------------
create table public.dd_wallets (
  participant_id uuid primary key references public.dd_participants (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create trigger dd_wallets_touch before update on public.dd_wallets
  for each row execute function public.dd_touch();

create table public.dd_items (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.dd_participants (id) on delete cascade,
  kind text not null check (kind in ('tell', 'ask')),
  body text not null check (char_length(body) between 1 and 500),
  -- 허용 범위(1~3)는 dd_settings 로 함수에서 검증한다. 여기서는 거친 안전 범위만 둔다.
  cost integer not null check (cost between 1 and 100),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dd_items_participant_idx on public.dd_items (participant_id, position);
create trigger dd_items_touch before update on public.dd_items
  for each row execute function public.dd_touch();

-- 열람 기록. 항목이 삭제되어도(item_id 가 null 이 되어도) 지불·보상 기록은 남는다.
create table public.dd_unlocks (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.dd_pairs (id) on delete cascade,
  item_id uuid references public.dd_items (id) on delete set null,
  viewer_id uuid not null references public.dd_participants (id) on delete cascade,
  owner_id uuid not null references public.dd_participants (id) on delete cascade,
  tokens_paid integer not null check (tokens_paid >= 1),
  created_at timestamptz not null default now(),
  -- 열람 시점의 내용 스냅샷. 항목이 나중에 삭제돼도 열람자는 독대가 끝나기 전까지 이 내용을 볼 수 있다.
  -- 독대가 끝나면 dd_end_pair 가 이 두 컬럼을 비운다(열람·거래 기록 자체는 남는다).
  snapshot_kind text check (snapshot_kind in ('tell', 'ask')),
  snapshot_body text check (char_length(snapshot_body) <= 500),
  -- 보상: 선택(reward_selected, 바꿀 수 있음)과 확정(reward_confirmed_at, 한 번만)을 구분한다. 0 도 유효한 선택이다.
  reward_selected integer check (reward_selected between 0 and 100),
  reward_amount integer check (reward_amount between 0 and 100),
  reward_confirmed_at timestamptz,
  check (viewer_id <> owner_id),
  check ((reward_confirmed_at is null) = (reward_amount is null)),
  unique (pair_id, item_id, viewer_id)
);
create index dd_unlocks_viewer_idx on public.dd_unlocks (viewer_id);
create index dd_unlocks_owner_idx on public.dd_unlocks (owner_id);

create table public.dd_token_tx (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.dd_rooms (id) on delete cascade,
  pair_id uuid references public.dd_pairs (id) on delete set null,
  unlock_id uuid references public.dd_unlocks (id) on delete set null,
  sender_id uuid references public.dd_participants (id) on delete set null,
  recipient_id uuid not null references public.dd_participants (id) on delete cascade,
  amount integer not null check (amount > 0),
  type text not null check (type in ('initial_grant', 'unlock_payment', 'reward')),
  created_at timestamptz not null default now(),
  check (type = 'initial_grant' or (sender_id is not null and unlock_id is not null)),
  check (type <> 'initial_grant' or sender_id is null)
);
-- 초기 지급은 참가자당 한 번, 열람 결제와 보상은 열람 건당 한 번만 기록될 수 있다.
create unique index dd_token_tx_initial_once on public.dd_token_tx (recipient_id) where type = 'initial_grant';
create unique index dd_token_tx_unlock_once on public.dd_token_tx (unlock_id, type) where type in ('unlock_payment', 'reward');
create index dd_token_tx_recipient_idx on public.dd_token_tx (recipient_id, created_at desc);
create index dd_token_tx_sender_idx on public.dd_token_tx (sender_id, created_at desc);

alter table public.dd_wallets enable row level security;
alter table public.dd_items enable row level security;
alter table public.dd_unlocks enable row level security;
alter table public.dd_token_tx enable row level security;
revoke all on table public.dd_wallets, public.dd_items, public.dd_unlocks, public.dd_token_tx from public, anon, authenticated;
grant select, insert, update, delete on table public.dd_wallets, public.dd_items, public.dd_unlocks, public.dd_token_tx to service_role;

-- ---------------------------------------------------------------------------
-- 초기 지급(멱등): 지갑이 없을 때만 만들고 그때만 거래를 기록한다.
-- ---------------------------------------------------------------------------
create function public.dd_grant_initial(p_participant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_amount integer := public.dd_setting('initial_tokens', 10);
begin
  select room_id into v_room from public.dd_participants where id = p_participant;
  if v_room is null then
    return;
  end if;
  insert into public.dd_wallets (participant_id, balance) values (p_participant, v_amount)
    on conflict (participant_id) do nothing;
  if found and v_amount > 0 then
    insert into public.dd_token_tx (room_id, recipient_id, amount, type) values (v_room, p_participant, v_amount, 'initial_grant');
  end if;
end;
$$;

-- 기존 참가자 백필(재실행해도 중복 지급되지 않는다)
with ins as (
  insert into public.dd_wallets (participant_id, balance)
  select p.id, public.dd_setting('initial_tokens', 10) from public.dd_participants p
  on conflict (participant_id) do nothing
  returning participant_id, balance
)
insert into public.dd_token_tx (room_id, recipient_id, amount, type)
select p.room_id, ins.participant_id, ins.balance, 'initial_grant'
from ins join public.dd_participants p on p.id = ins.participant_id
where ins.balance > 0;

-- 참가자 행이 어떤 경로로 만들어지든 초기 지급이 정확히 한 번 일어나도록 트리거로 보장한다.
-- (dd_create_room / dd_join_room 을 교체하지 않아도 된다. 지갑 PK 와 거래 유일 인덱스가 이중 안전장치.)
create function public.dd_participant_grant_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.dd_grant_initial(new.id);
  return new;
end;
$$;
create trigger dd_participants_grant after insert on public.dd_participants
  for each row execute function public.dd_participant_grant_trigger();

-- 독대 요청: 질문 구성(ready) 조건 제거. 같은 방의 다른 참가자에게 요청할 수 있다.
create or replace function public.dd_request_pair(p_participant uuid, p_peer uuid)
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
  begin
    insert into public.dd_pairs (room_id, a_id, b_id) values (me.room_id, me.id, peer.id) returning id into v_id;
  exception when unique_violation then
    perform public.dd_fail('PAIR_EXISTS');
  end;
  return v_id;
end;
$$;

-- 독대 조회 교체: 소개글(bio)은 기존 정책(reviewing/active)을 유지하고, 질문·답변은 더 이상 내려보내지 않는다.
-- (answers 키는 null 로 유지해 이전 버전 화면과 호환된다.)
create or replace function public.dd_view_pair(p_participant uuid, p_pair uuid)
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
      'answers', null
    )
  );
end;
$$;

-- 종료(또는 시작 전 취소) 교체: 종료되면 이 독대의 열람 스냅샷 내용을 비운다(열람·거래 기록은 남긴다).
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
  update public.dd_unlocks set snapshot_kind = null, snapshot_body = null where pair_id = v.id;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 내 항목 관리
-- ---------------------------------------------------------------------------
create function public.dd_my_items(p_participant uuid)
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
    'max_items', public.dd_setting('max_items', 10),
    'cost_min', public.dd_setting('item_cost_min', 1),
    'cost_max', public.dd_setting('item_cost_max', 3),
    'reward_max', public.dd_setting('reward_max', 5),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'body', i.body, 'cost', i.cost,
        -- 열람 현황: 누가(닉네임만) 언제 열었고 보상이 확정됐는지. 상대의 미확정 선택값은 보이지 않는다.
        'opens', coalesce((
          select jsonb_agg(jsonb_build_object(
            'unlock_id', u.id, 'viewer_nickname', v.nickname, 'opened_at', u.created_at, 'tokens_paid', u.tokens_paid,
            'reward_confirmed', u.reward_confirmed_at is not null,
            'reward_amount', case when u.reward_confirmed_at is not null then u.reward_amount end
          ) order by u.created_at)
          from public.dd_unlocks u join public.dd_participants v on v.id = u.viewer_id
          where u.item_id = i.id
        ), '[]'::jsonb)
      ) order by i.position, i.created_at)
      from public.dd_items i where i.participant_id = me.id
    ), '[]'::jsonb),
    -- 삭제한 항목의 열람·보상 기록(내용 없음)
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

create function public.dd_add_item(p_participant uuid, p_kind text, p_body text, p_cost integer)
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
  if p_kind not in ('tell', 'ask') or char_length(v_body) not between 1 and 500
     or p_cost is null or p_cost < public.dd_setting('item_cost_min', 1) or p_cost > public.dd_setting('item_cost_max', 3) then
    perform public.dd_fail('VALIDATION');
  end if;
  -- 동시 추가로 한도를 넘지 않도록 참가자 행을 잠근 뒤 센다.
  perform 1 from public.dd_participants where id = me.id for update;
  if (select count(*) from public.dd_items where participant_id = me.id) >= public.dd_setting('max_items', 10) then
    perform public.dd_fail('ITEM_LIMIT');
  end if;
  insert into public.dd_items (participant_id, kind, body, cost, position)
    values (me.id, p_kind, v_body, p_cost,
            coalesce((select max(position) from public.dd_items where participant_id = me.id), 0) + 1)
    returning id into v_id;
  return v_id;
end;
$$;

create function public.dd_update_item(p_participant uuid, p_item uuid, p_kind text, p_body text, p_cost integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v_body text := btrim(coalesce(p_body, ''));
  v_item public.dd_items;
begin
  if p_kind not in ('tell', 'ask') or char_length(v_body) not between 1 and 500
     or p_cost is null or p_cost < public.dd_setting('item_cost_min', 1) or p_cost > public.dd_setting('item_cost_max', 3) then
    perform public.dd_fail('VALIDATION');
  end if;
  -- 항목 행을 먼저 잠근 뒤 열람 여부를 확인한다(동시 열람과 엇갈려도 열람된 항목의 내용이 바뀌지 않는다).
  select * into v_item from public.dd_items where id = p_item and participant_id = me.id for update;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if (v_item.kind <> p_kind or v_item.body <> v_body)
     and exists (select 1 from public.dd_unlocks where item_id = v_item.id) then
    perform public.dd_fail('ITEM_LOCKED'); -- 이미 열람된 항목: 삭제 후 새 항목으로 등록해야 한다.
  end if;
  -- 비용 변경은 허용한다. 이미 낸 비용은 소급 청구하지 않으며 새 열람부터 새 비용이 적용된다.
  update public.dd_items set kind = p_kind, body = v_body, cost = p_cost where id = v_item.id;
end;
$$;

-- 삭제해도 열람·보상 기록은 남는다(item_id 만 null). 삭제된 항목의 본문은 더 이상 볼 수 없다.
create function public.dd_delete_item(p_participant uuid, p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
begin
  delete from public.dd_items where id = p_item and participant_id = me.id;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 상대 항목(블라인드): active 독대에서만 목록을 준다. 열람 전에는 id·순번·비용·잠금 여부 외에는 아무것도 없다
-- (유형, 본문, 길이, 미리보기 모두 없음). 종료된 독대는 내가 열람한 건의 결제·보상 상태만 준다(본문 없음).
-- ---------------------------------------------------------------------------
create function public.dd_peer_items(p_participant uuid, p_pair uuid)
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
    -- 열람 전 정보는 id·순번·비용·열람 여부뿐이다. 유형·본문·길이는 없다. active 독대에서만 준다.
    'items', case when v.status = 'active' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'ordinal', x.ord, 'cost', x.cost, 'unlocked', x.unlocked) order by x.ord)
      from (
        select i.id, i.cost, row_number() over (order by i.position, i.created_at) as ord,
               exists (select 1 from public.dd_unlocks u where u.item_id = i.id and u.pair_id = v.id and u.viewer_id = me.id) as unlocked
        from public.dd_items i where i.participant_id = v_peer
      ) x
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- 내가 이 독대에서 연 건. 열람 당시 내용(스냅샷)은 독대가 active 인 동안에만, 본인 열람건에 한해 준다.
    -- 항목이 삭제되었어도(item_id null) 스냅샷으로 계속 볼 수 있다. 종료 후에는 내용 없이 결제·보상 현황만 남는다.
    'opened', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unlock_id', u.id,
        'kind', case when v.status = 'active' then u.snapshot_kind end,
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

-- ---------------------------------------------------------------------------
-- 열람(결제): 차감 + 소유자 이전 + 열람 기록 + 거래 기록이 한 트랜잭션.
-- 잠금 순서: 독대(for share) → 항목(for share) → 두 지갑(참가자 ID 순, for update).
-- ---------------------------------------------------------------------------
create function public.dd_unlock_item(p_participant uuid, p_pair uuid, p_item uuid, p_expected_cost integer)
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
begin
  select * into v from public.dd_pairs where id = p_pair and (a_id = me.id or b_id = me.id) for share;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v.status <> 'active' then
    perform public.dd_fail('INVALID_STATE');
  end if;
  v_owner := case when v.a_id = me.id then v.b_id else v.a_id end;

  -- 상대의 항목만 열 수 있다(본인 항목·다른 방 항목·임의의 ID 는 존재하지 않는 것으로 취급)
  select * into v_item from public.dd_items where id = p_item and participant_id = v_owner for share;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;

  perform 1 from public.dd_wallets where participant_id in (me.id, v_owner) order by participant_id for update;

  -- 같은 독대에서 이미 연 항목이면 다시 청구하지 않는다(더블클릭·재시도·동시 요청 모두 여기서 걸러진다).
  select * into v_unlock from public.dd_unlocks where pair_id = v.id and item_id = v_item.id and viewer_id = me.id;
  if found then
    select balance into v_balance from public.dd_wallets where participant_id = me.id;
    return jsonb_build_object('already_unlocked', true, 'unlock_id', v_unlock.id, 'balance', v_balance,
                              'kind', v_unlock.snapshot_kind, 'body', v_unlock.snapshot_body);
  end if;

  if p_expected_cost is null or p_expected_cost <> v_item.cost then
    perform public.dd_fail('PRICE_CHANGED');
  end if;
  select balance into v_balance from public.dd_wallets where participant_id = me.id;
  if v_balance is null or v_balance < v_item.cost then
    perform public.dd_fail('INSUFFICIENT_BALANCE');
  end if;

  update public.dd_wallets set balance = balance - v_item.cost where participant_id = me.id;
  update public.dd_wallets set balance = balance + v_item.cost where participant_id = v_owner;
  insert into public.dd_unlocks (pair_id, item_id, viewer_id, owner_id, tokens_paid, snapshot_kind, snapshot_body)
    values (v.id, v_item.id, me.id, v_owner, v_item.cost, v_item.kind, v_item.body) returning id into v_unlock_id;
  insert into public.dd_token_tx (room_id, pair_id, unlock_id, sender_id, recipient_id, amount, type)
    values (v.room_id, v.id, v_unlock_id, me.id, v_owner, v_item.cost, 'unlock_payment');

  return jsonb_build_object('already_unlocked', false, 'unlock_id', v_unlock_id, 'balance', v_balance - v_item.cost,
                            'kind', v_item.kind, 'body', v_item.body);
end;
$$;

-- ---------------------------------------------------------------------------
-- 보상: 선택(수량, 바꿀 수 있음) → 확정(실제 지급, 열람 건당 한 번). 독대 종료 후에도 가능.
-- ---------------------------------------------------------------------------
create function public.dd_set_reward(p_participant uuid, p_unlock uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_unlocks;
begin
  if p_amount is null or p_amount < 0 or p_amount > public.dd_setting('reward_max', 5) then
    perform public.dd_fail('VALIDATION');
  end if;
  select * into v from public.dd_unlocks where id = p_unlock and viewer_id = me.id for update;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v.reward_confirmed_at is not null then
    perform public.dd_fail('REWARD_DONE');
  end if;
  update public.dd_unlocks set reward_selected = p_amount where id = v.id;
  return jsonb_build_object('reward_selected', p_amount);
end;
$$;

create function public.dd_confirm_reward(p_participant uuid, p_unlock uuid, p_expected_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
  v public.dd_unlocks;
  v_room uuid;
  v_balance integer;
begin
  select * into v from public.dd_unlocks where id = p_unlock and viewer_id = me.id for update;
  if not found then
    perform public.dd_fail('NOT_FOUND');
  end if;
  if v.reward_confirmed_at is not null then -- 이미 확정: 중복 요청은 아무것도 바꾸지 않는다.
    select balance into v_balance from public.dd_wallets where participant_id = me.id;
    return jsonb_build_object('duplicate', true, 'reward_amount', v.reward_amount, 'balance', v_balance);
  end if;
  if v.reward_selected is null then
    perform public.dd_fail('REWARD_NOT_SELECTED');
  end if;
  if p_expected_amount is null or p_expected_amount <> v.reward_selected then
    perform public.dd_fail('REWARD_CHANGED');
  end if;

  perform 1 from public.dd_wallets where participant_id in (me.id, v.owner_id) order by participant_id for update;
  select balance into v_balance from public.dd_wallets where participant_id = me.id;
  if v.reward_selected > 0 then
    if v_balance < v.reward_selected then
      perform public.dd_fail('INSUFFICIENT_BALANCE');
    end if;
    select room_id into v_room from public.dd_participants where id = me.id;
    update public.dd_wallets set balance = balance - v.reward_selected where participant_id = me.id;
    update public.dd_wallets set balance = balance + v.reward_selected where participant_id = v.owner_id;
    insert into public.dd_token_tx (room_id, pair_id, unlock_id, sender_id, recipient_id, amount, type)
      values (v_room, v.pair_id, v.id, me.id, v.owner_id, v.reward_selected, 'reward');
    v_balance := v_balance - v.reward_selected;
  end if;
  update public.dd_unlocks set reward_amount = v.reward_selected, reward_confirmed_at = now() where id = v.id;
  return jsonb_build_object('duplicate', false, 'reward_amount', v.reward_selected, 'balance', v_balance);
end;
$$;

-- 내 거래 내역(내가 보내거나 받은 것만, 내용 없음)
create function public.dd_my_transactions(p_participant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.dd_participants := public.dd_actor(p_participant);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'type', t.type, 'amount', t.amount, 'created_at', t.created_at,
      'direction', case when t.recipient_id = me.id then 'in' else 'out' end,
      'counterpart', (select nickname from public.dd_participants o
                      where o.id = case when t.recipient_id = me.id then t.sender_id else t.recipient_id end)
    ) order by t.created_at desc)
    from (select * from public.dd_token_tx
          where recipient_id = me.id or sender_id = me.id order by created_at desc limit 50) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 공개 래퍼(anon): 방 ID + 참가자 토큰을 DB 안에서 검증한다.
-- ---------------------------------------------------------------------------
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
    'items_count', (select count(*) from public.dd_items where participant_id = v_me)
  );
end;
$$;

create function public.dd_api_my_items(p_room uuid, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.dd_my_items(public.dd_resolve(p_room, p_token))
$$;
create function public.dd_api_add_item(p_room uuid, p_token text, p_kind text, p_body text, p_cost integer)
returns uuid language sql security definer set search_path = '' as $$
  select public.dd_add_item(public.dd_resolve(p_room, p_token), p_kind, p_body, p_cost)
$$;
create function public.dd_api_update_item(p_room uuid, p_token text, p_item uuid, p_kind text, p_body text, p_cost integer)
returns void language sql security definer set search_path = '' as $$
  select public.dd_update_item(public.dd_resolve(p_room, p_token), p_item, p_kind, p_body, p_cost)
$$;
create function public.dd_api_delete_item(p_room uuid, p_token text, p_item uuid)
returns void language sql security definer set search_path = '' as $$
  select public.dd_delete_item(public.dd_resolve(p_room, p_token), p_item)
$$;
create function public.dd_api_peer_items(p_room uuid, p_token text, p_pair uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.dd_peer_items(public.dd_resolve(p_room, p_token), p_pair)
$$;
create function public.dd_api_unlock_item(p_room uuid, p_token text, p_pair uuid, p_item uuid, p_expected_cost integer)
returns jsonb language sql security definer set search_path = '' as $$
  select public.dd_unlock_item(public.dd_resolve(p_room, p_token), p_pair, p_item, p_expected_cost)
$$;
create function public.dd_api_set_reward(p_room uuid, p_token text, p_unlock uuid, p_amount integer)
returns jsonb language sql security definer set search_path = '' as $$
  select public.dd_set_reward(public.dd_resolve(p_room, p_token), p_unlock, p_amount)
$$;
create function public.dd_api_confirm_reward(p_room uuid, p_token text, p_unlock uuid, p_expected_amount integer)
returns jsonb language sql security definer set search_path = '' as $$
  select public.dd_confirm_reward(public.dd_resolve(p_room, p_token), p_unlock, p_expected_amount)
$$;
create function public.dd_api_my_transactions(p_room uuid, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.dd_my_transactions(public.dd_resolve(p_room, p_token))
$$;

-- ---------------------------------------------------------------------------
-- 권한: 내부 함수는 service_role 전용(기본 권한을 명시적으로 회수), dd_api_* 만 anon/authenticated.
-- ---------------------------------------------------------------------------
revoke all on function
  public.dd_setting(text, integer), public.dd_grant_initial(uuid), public.dd_participant_grant_trigger(),
  public.dd_my_items(uuid), public.dd_add_item(uuid, text, text, integer),
  public.dd_update_item(uuid, uuid, text, text, integer), public.dd_delete_item(uuid, uuid),
  public.dd_peer_items(uuid, uuid), public.dd_unlock_item(uuid, uuid, uuid, integer),
  public.dd_set_reward(uuid, uuid, integer), public.dd_confirm_reward(uuid, uuid, integer),
  public.dd_my_transactions(uuid)
  from public, anon, authenticated;
grant execute on function
  public.dd_setting(text, integer), public.dd_grant_initial(uuid),
  public.dd_my_items(uuid), public.dd_add_item(uuid, text, text, integer),
  public.dd_update_item(uuid, uuid, text, text, integer), public.dd_delete_item(uuid, uuid),
  public.dd_peer_items(uuid, uuid), public.dd_unlock_item(uuid, uuid, uuid, integer),
  public.dd_set_reward(uuid, uuid, integer), public.dd_confirm_reward(uuid, uuid, integer),
  public.dd_my_transactions(uuid)
  to service_role;

revoke all on function
  public.dd_api_my_items(uuid, text), public.dd_api_add_item(uuid, text, text, text, integer),
  public.dd_api_update_item(uuid, text, uuid, text, text, integer), public.dd_api_delete_item(uuid, text, uuid),
  public.dd_api_peer_items(uuid, text, uuid), public.dd_api_unlock_item(uuid, text, uuid, uuid, integer),
  public.dd_api_set_reward(uuid, text, uuid, integer), public.dd_api_confirm_reward(uuid, text, uuid, integer),
  public.dd_api_my_transactions(uuid, text)
  from public;
grant execute on function
  public.dd_api_my_items(uuid, text), public.dd_api_add_item(uuid, text, text, text, integer),
  public.dd_api_update_item(uuid, text, uuid, text, text, integer), public.dd_api_delete_item(uuid, text, uuid),
  public.dd_api_peer_items(uuid, text, uuid), public.dd_api_unlock_item(uuid, text, uuid, uuid, integer),
  public.dd_api_set_reward(uuid, text, uuid, integer), public.dd_api_confirm_reward(uuid, text, uuid, integer),
  public.dd_api_my_transactions(uuid, text)
  to anon, authenticated;
