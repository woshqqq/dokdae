-- 독대 화면 동기화용 Realtime 테이블.
-- postgres_changes 는 구독자의 RLS를 따른다(INSERT/UPDATE). 단, Supabase는 DELETE 이벤트에는 RLS를 적용하지
-- 못하고 기본 키만 전달하므로, 앱은 이벤트 내용을 쓰지 않고 "다시 불러오기" 신호로만 사용한다.
-- wallets는 넣지 않는다: 기본 키가 (room_id, user_id)라서 DELETE 이벤트로 모임 참여자 ID가
-- 모든 구독자에게 노출된다. 잔액 변경은 항상 token_transactions INSERT를 동반하므로 그 이벤트로 갱신한다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.pair_sessions,
      public.question_unlocks,
      public.token_transactions;
  end if;
end;
$$;
