import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashInviteCode } from "../../src/lib/data/mock/engine";
import { DEFAULT_QUESTION_LABELS, DEFAULT_ROOM_SETTINGS } from "../../src/lib/data/settings";
import type { ProfileEditor, RoomSettings, SessionView } from "../../src/lib/data/types";
import { TestDb, errorOf } from "./harness";

// Supabase 마이그레이션(RLS·GRANT·RPC)을 실제 PostgreSQL 엔진(PGlite)에 적용해 검증한다.

let db: TestDb;

beforeAll(async () => {
  db = await TestDb.create();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

interface Fixture {
  ownerId: string;
  memberId: string;
  outsiderId: string;
  roomId: string;
  inviteCode: string;
  sessionId: string;
  /** 참여자(B)의 첫 질문: 답변 "B의 비밀 답변", 비용 3 */
  questionId: string;
}

let f: Fixture;

async function balance(roomId: string, userId: string) {
  const rows = await db.admin<{ balance: number }>(`select balance from wallets where room_id = $1 and user_id = $2`, [roomId, userId]);
  return rows[0]?.balance;
}

async function setup(): Promise<Fixture> {
  const ownerId = await db.createUser("에이");
  const memberId = await db.createUser("비");
  const outsiderId = await db.createUser("씨");
  const { roomId, inviteCode } = await db.rpc<{ roomId: string; inviteCode: string }>(ownerId, "create_room", ["테스트 모임", "", "에이"]);
  await db.rpc(memberId, "join_room", [inviteCode, "비"]);
  const editor = await db.rpc<ProfileEditor>(memberId, "get_profile_editor", [roomId]);
  await db.rpc(memberId, "update_profile", [
    roomId,
    "비",
    JSON.stringify(
      editor.questions.map((q, i) => ({ id: q.id, answer: i === 0 ? "B의 비밀 답변" : "", tokenCost: 3, isEnabled: true })),
    ),
  ]);
  const { sessionId } = await db.rpc<{ sessionId: string }>(ownerId, "request_session", [roomId, memberId]);
  await db.rpc(memberId, "respond_to_session", [sessionId, true]);
  return { ownerId, memberId, outsiderId, roomId, inviteCode, sessionId, questionId: editor.questions[0].id };
}

beforeEach(async () => {
  f = await setup();
});

describe("마이그레이션 일관성", () => {
  it("DB 기본 설정값과 예시 질문이 앱 기본값과 같다", async () => {
    const admin = await db.rpc<{ settings: RoomSettings; templates: { label: string }[] }>(f.ownerId, "get_room_admin", [f.roomId]);
    expect(admin.settings).toEqual(DEFAULT_ROOM_SETTINGS);
    expect(admin.templates.map((t) => t.label)).toEqual(DEFAULT_QUESTION_LABELS);
  });

  it("초대 코드 해시가 앱(mock)과 같은 방식이다", async () => {
    const rows = await db.admin<{ invite_code_hash: string }>(`select invite_code_hash from rooms where id = $1`, [f.roomId]);
    expect(rows[0].invite_code_hash).toBe(hashInviteCode(f.inviteCode));
    expect(f.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("모든 public 테이블에 RLS가 켜져 있다", async () => {
    const rows = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("anon·authenticated에는 어떤 테이블 쓰기 권한도 없다", async () => {
    const rows = await db.admin<{ role: string; table_name: string; privilege: string }>(
      `select r.role, c.relname as table_name, p.privilege
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join (values ('anon'), ('authenticated')) r(role)
       cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege)
       where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r.role, c.oid, p.privilege)`,
    );
    expect(rows).toEqual([]);
  });

  it("anon은 어떤 테이블도 읽을 수 없고 어떤 public 함수도 실행할 수 없다", async () => {
    const tables = await db.admin(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'SELECT')`,
    );
    const fns = await db.admin(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(tables).toEqual([]);
    expect(fns).toEqual([]);
  });

  it("SECURITY DEFINER 함수는 모두 search_path가 고정되어 있다", async () => {
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not coalesce(p.proconfig, '{}') @> array['search_path=""']`,
    );
    expect(rows).toEqual([]);
    const definers = await db.admin<{ n: number }>(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef`,
    );
    expect(definers[0].n).toBeGreaterThanOrEqual(20);
  });

  it("(대조군) 테스트 환경은 Supabase처럼 새 객체에 anon 권한을 기본 부여한다", async () => {
    // 마이그레이션이 바꾼 기본 권한과 무관한 다른 역할(postgres가 아닌 소유자)로 만든 객체로 확인한다.
    await db.adminExec(`
      create role test_owner;
      grant create, usage on schema public to test_owner;
      alter default privileges for role test_owner in schema public grant all on tables to anon;
      set role test_owner;
      create table public.test_control (id int);
      reset role;
    `);
    try {
      const rows = await db.admin<{ ok: boolean }>(`select has_table_privilege('anon', 'public.test_control', 'INSERT') as ok`);
      expect(rows[0].ok).toBe(true);
    } finally {
      await db.adminExec(`drop table public.test_control; drop owned by test_owner; drop role test_owner;`);
    }
  });

  it("마이그레이션 이후 postgres가 새로 만드는 테이블에도 anon·authenticated 권한이 자동으로 붙지 않는다", async () => {
    await db.adminExec(`create table public.test_future (id int);`);
    try {
      const rows = await db.admin<{ anon: boolean; auth: boolean }>(
        `select has_table_privilege('anon', 'public.test_future', 'SELECT') as anon,
                has_table_privilege('authenticated', 'public.test_future', 'INSERT') as auth`,
      );
      expect(rows[0]).toEqual({ anon: false, auth: false });
    } finally {
      await db.adminExec(`drop table public.test_future;`);
    }
  });

  it("상태를 바꾸는 내부 헬퍼는 authenticated가 직접 실행할 수 없다", async () => {
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname in ('add_member', 'finish_session', 'expire_stale_sessions', 'lock_wallets', 'lock_members',
                           'lock_tradable_session', 'require_active_room', 'handle_new_user', 'random_invite_code')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("미인증·비회원 접근 차단", () => {
  it("anon은 테이블 조회와 RPC 호출이 모두 거부된다", async () => {
    expect((await errorOf(db.as({ role: "anon" }, `select * from public.member_question_answers`))).message).toMatch(/permission denied/);
    expect((await errorOf(db.as({ role: "anon" }, `select public.list_my_rooms()`))).message).toMatch(/permission denied/);
  });

  it("로그인 정보 없이 호출하면 UNAUTHENTICATED", async () => {
    expect((await errorOf(db.rpc(null, "list_my_rooms"))).message).toBe("UNAUTHENTICATED");
    expect((await errorOf(db.rpc(null, "join_room", [f.inviteCode, "익명"]))).message).toBe("UNAUTHENTICATED");
  });

  it("비회원은 RPC와 직접 조회 모두로 모임 데이터를 볼 수 없다", async () => {
    expect((await errorOf(db.rpc(f.outsiderId, "get_room_dashboard", [f.roomId]))).message).toBe("NOT_MEMBER");
    expect((await errorOf(db.rpc(f.outsiderId, "get_member_profile", [f.roomId, f.memberId]))).message).toBe("NOT_MEMBER");
    expect((await errorOf(db.rpc(f.outsiderId, "get_session_view", [f.sessionId]))).message).toBe("NOT_FOUND");
    const who = { role: "authenticated" as const, uid: f.outsiderId };
    const queries: [string, string][] = [
      ["rooms", `select id, name from public.rooms where id = $1`],
      ["room_settings", `select * from public.room_settings where room_id = $1`],
      ["room_members", `select * from public.room_members where room_id = $1`],
      ["question_templates", `select * from public.question_templates where room_id = $1`],
      ["member_questions", `select * from public.member_questions where room_id = $1`],
      ["member_question_answers", `select * from public.member_question_answers where $1::uuid is not null`],
      ["wallets", `select * from public.wallets where room_id = $1`],
      ["pair_sessions", `select * from public.pair_sessions where room_id = $1`],
      ["question_unlocks", `select * from public.question_unlocks where room_id = $1`],
      ["token_transactions", `select * from public.token_transactions where room_id = $1`],
    ];
    for (const [table, sql] of queries) {
      expect(await db.as(who, sql, [f.roomId]), table).toEqual([]);
    }
  });

  it("초대 코드 해시 컬럼은 참여자도 조회할 수 없다", async () => {
    const err = await errorOf(db.as({ role: "authenticated", uid: f.ownerId }, `select invite_code_hash from public.rooms`));
    expect(err.message).toMatch(/permission denied/);
  });

  it("잘못된 초대 코드로는 가입할 수 없다", async () => {
    expect((await errorOf(db.rpc(f.outsiderId, "join_room", ["WRONG-CODE", "씨"]))).message).toBe("INVALID_INVITE_CODE");
  });
});

describe("가입과 초기 토큰", () => {
  it("초기 토큰은 한 번만 지급된다(재가입·대소문자 다른 코드 포함)", async () => {
    const again = await db.rpc<{ alreadyMember: boolean }>(f.memberId, "join_room", [f.inviteCode.toLowerCase(), "비"]);
    expect(again.alreadyMember).toBe(true);
    const grants = await db.admin(`select * from token_transactions where room_id = $1 and recipient_id = $2 and type = 'initial_grant'`, [f.roomId, f.memberId]);
    expect(grants).toHaveLength(1);
  });

  it("초기 지급 기록은 데이터베이스 제약으로도 한 번만 허용된다", async () => {
    const err = await errorOf(
      db.admin(`insert into token_transactions (room_id, recipient_id, amount, type) values ($1, $2, 10, 'initial_grant')`, [f.roomId, f.memberId]),
    );
    expect(err.message).toMatch(/duplicate key/);
  });
});

describe("프로필·운영자 권한", () => {
  it("다른 참여자의 질문은 update_profile로 수정할 수 없다", async () => {
    const err = await errorOf(
      db.rpc(f.ownerId, "update_profile", [f.roomId, "에이", JSON.stringify([{ id: f.questionId, answer: "덮어쓰기", tokenCost: 1, isEnabled: true }])]),
    );
    expect(err.message).toBe("FORBIDDEN");
    const rows = await db.admin<{ answer: string }>(`select answer from member_question_answers where question_id = $1`, [f.questionId]);
    expect(rows[0].answer).toBe("B의 비밀 답변");
  });

  it("테이블을 직접 수정하는 요청은 모두 거부된다", async () => {
    const who = { role: "authenticated" as const, uid: f.memberId };
    const attempts = [
      [`update public.member_question_answers set answer = 'x' where question_id = $1`, [f.questionId]],
      [`update public.room_members set nickname = '해킹' where room_id = $1`, [f.roomId]],
      [`update public.profiles set display_name = '해킹'`, []],
    ] as const;
    for (const [sql, params] of attempts) {
      expect((await errorOf(db.as(who, sql, [...params]))).message).toMatch(/permission denied/);
    }
  });

  it("참여자는 운영자 역할을 위조할 수 없다", async () => {
    const who = { role: "authenticated" as const, uid: f.memberId };
    expect((await errorOf(db.as(who, `update public.room_members set role = 'owner' where user_id = $1`, [f.memberId]))).message).toMatch(/permission denied/);
    expect((await errorOf(db.as(who, `insert into public.room_members (room_id, user_id, role, nickname) values ($1, $2, 'owner', 'x')`, [f.roomId, f.outsiderId]))).message).toMatch(/permission denied/);
    expect((await errorOf(db.as(who, `update public.rooms set owner_id = $1 where id = $2`, [f.memberId, f.roomId]))).message).toMatch(/permission denied/);
    expect((await errorOf(db.rpc(f.memberId, "get_room_admin", [f.roomId]))).message).toBe("FORBIDDEN");
    expect((await errorOf(db.rpc(f.memberId, "update_room_settings", [f.roomId, JSON.stringify({ ...DEFAULT_ROOM_SETTINGS, initialTokens: 999 })]))).message).toBe("FORBIDDEN");
    expect((await errorOf(db.rpc(f.memberId, "close_room", [f.roomId]))).message).toBe("FORBIDDEN");
    expect((await errorOf(db.rpc(f.memberId, "regenerate_invite_code", [f.roomId]))).message).toBe("FORBIDDEN");
  });

  it("범위를 벗어난 열람 비용은 저장되지 않는다", async () => {
    const err = await errorOf(
      db.rpc(f.memberId, "update_profile", [f.roomId, "비", JSON.stringify([{ id: f.questionId, answer: "a", tokenCost: 99, isEnabled: true }])]),
    );
    expect(err.message).toBe("VALIDATION");
    expect(err.detail).toContain("0~5");
  });
});

describe("블라인드 답변", () => {
  it("열기 전에는 상대 답변 원문을 직접 SELECT로 가져올 수 없다", async () => {
    const who = { role: "authenticated" as const, uid: f.ownerId };
    expect(await db.as(who, `select * from public.member_question_answers where question_id = $1`, [f.questionId])).toEqual([]);
    const view = await db.rpc<SessionView>(f.ownerId, "get_session_view", [f.sessionId]);
    expect(JSON.stringify(view)).not.toContain("B의 비밀 답변");
    const profile = await db.rpc(f.ownerId, "get_member_profile", [f.roomId, f.memberId]);
    expect(JSON.stringify(profile)).not.toContain("B의 비밀 답변");
  });

  it("활성 독대에서 연 뒤에만 보이고, 종료(보관 중 포함) 즉시 다시 막힌다", async () => {
    await db.admin(`update room_settings set session_retention_days = 7 where room_id = $1`, [f.roomId]);
    await db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3]);
    const who = { role: "authenticated" as const, uid: f.ownerId };
    expect(await db.as(who, `select answer from public.member_question_answers where question_id = $1`, [f.questionId])).toEqual([{ answer: "B의 비밀 답변" }]);
    const view = await db.rpc<SessionView>(f.ownerId, "get_session_view", [f.sessionId]);
    expect(view.partnerQuestions[0].answer).toBe("B의 비밀 답변");

    await db.rpc(f.ownerId, "vote_end_session", [f.sessionId]);
    await db.rpc(f.memberId, "vote_end_session", [f.sessionId]);
    expect(await db.as(who, `select answer from public.member_question_answers where question_id = $1`, [f.questionId])).toEqual([]);
    const closed = await db.rpc<SessionView>(f.ownerId, "get_session_view", [f.sessionId]);
    expect(closed.session.status).toBe("closed");
    expect(closed.partnerQuestions[0].answer).toBeNull();
  });

  it("같은 상대와 새 독대를 열면 과거 열람 권한을 재사용하지 않는다", async () => {
    await db.admin(`update room_settings set session_retention_days = 7 where room_id = $1`, [f.roomId]);
    await db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3]);
    await db.rpc(f.ownerId, "vote_end_session", [f.sessionId]);
    await db.rpc(f.memberId, "vote_end_session", [f.sessionId]);
    const { sessionId } = await db.rpc<{ sessionId: string }>(f.ownerId, "request_session", [f.roomId, f.memberId]);
    await db.rpc(f.memberId, "respond_to_session", [sessionId, true]);
    const view = await db.rpc<SessionView>(f.ownerId, "get_session_view", [sessionId]);
    expect(view.partnerQuestions[0].unlocked).toBe(false);
    expect(view.partnerQuestions[0].answer).toBeNull();
  });

  it("비공개로 바꾼 질문은 메타데이터도 상대에게 보이지 않는다", async () => {
    await db.rpc(f.memberId, "update_profile", [f.roomId, "비", JSON.stringify([{ id: f.questionId, answer: "B의 비밀 답변", tokenCost: 3, isEnabled: false }])]);
    const who = { role: "authenticated" as const, uid: f.ownerId };
    expect(await db.as(who, `select id from public.member_questions where id = $1`, [f.questionId])).toEqual([]);
    expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3]))).message).toBe("QUESTION_UNAVAILABLE");
  });
});

describe("질문 열기 정산", () => {
  it("비용만큼 이전되고, 다시 열어도 추가 차감되지 않는다", async () => {
    expect(await db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3])).toEqual({ alreadyUnlocked: false, balance: 7 });
    expect(await db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3])).toEqual({ alreadyUnlocked: true, balance: 7 });
    expect(await balance(f.roomId, f.ownerId)).toBe(7);
    expect(await balance(f.roomId, f.memberId)).toBe(13);
    const tx = await db.admin(`select * from token_transactions where session_id = $1 and type = 'unlock_payment'`, [f.sessionId]);
    expect(tx).toHaveLength(1);
  });

  it("잔액이 부족하면 거절되고, 잔액을 연속으로 초과 사용할 수 없다", async () => {
    await db.admin(`update wallets set balance = 4 where room_id = $1 and user_id = $2`, [f.roomId, f.ownerId]);
    // 두 번째 질문도 답변·공개
    const editor = await db.rpc<ProfileEditor>(f.memberId, "get_profile_editor", [f.roomId]);
    await db.rpc(f.memberId, "update_profile", [
      f.roomId,
      "비",
      JSON.stringify(editor.questions.map((q, i) => ({ id: q.id, answer: i < 2 ? `답변${i}` : "", tokenCost: 3, isEnabled: true }))),
    ]);
    await db.rpc(f.ownerId, "unlock_question", [f.sessionId, editor.questions[0].id, 3]);
    const err = await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, editor.questions[1].id, 3]));
    expect(err.message).toBe("INSUFFICIENT_BALANCE");
    expect(await balance(f.roomId, f.ownerId)).toBe(1);
    expect(await balance(f.roomId, f.memberId)).toBe(13);
  });

  it("지갑 잔액은 데이터베이스 제약으로도 음수가 될 수 없다", async () => {
    const err = await errorOf(db.admin(`update wallets set balance = -1 where room_id = $1 and user_id = $2`, [f.roomId, f.ownerId]));
    expect(err.message).toMatch(/check constraint/);
  });

  it("자기 질문, 없는 질문, 다른 모임 질문은 거절된다", async () => {
    const mine = await db.admin<{ id: string }>(`select id from member_questions where owner_id = $1 limit 1`, [f.ownerId]);
    expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, mine[0].id, 1]))).message).toBe("SELF_ACTION");
    expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, "00000000-0000-0000-0000-000000000000", 1]))).message).toBe("QUESTION_UNAVAILABLE");
    const other = await db.rpc<{ roomId: string }>(f.outsiderId, "create_room", ["다른 모임", "", "씨"]);
    const foreign = await db.admin<{ id: string }>(`select id from member_questions where room_id = $1 limit 1`, [other.roomId]);
    expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, foreign[0].id, 1]))).message).toBe("QUESTION_UNAVAILABLE");
  });

  it("확인한 비용과 거래 시점 비용이 다르면 거절된다", async () => {
    expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 1]))).message).toBe("PRICE_CHANGED");
    expect(await balance(f.roomId, f.ownerId)).toBe(10);
  });

  it("당사자가 아니면 결제할 수 없다", async () => {
    await db.rpc(f.outsiderId, "join_room", [f.inviteCode, "씨"]);
    expect((await errorOf(db.rpc(f.outsiderId, "unlock_question", [f.sessionId, f.questionId, 3]))).message).toBe("NOT_FOUND");
  });

  it("거래 중간에 실패하면 잔액·열람 기록이 모두 롤백된다", async () => {
    await db.adminExec(`
      create or replace function public.test_fail_tx() returns trigger language plpgsql as $$
      begin raise exception 'INJECTED_FAILURE'; end $$;
      create trigger test_fail_tx before insert on public.token_transactions for each row execute function public.test_fail_tx();
    `);
    try {
      expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3]))).message).toBe("INJECTED_FAILURE");
      expect((await errorOf(db.rpc(f.ownerId, "send_gift", [f.sessionId, 2, "req-rollback-1"]))).message).toBe("INJECTED_FAILURE");
    } finally {
      await db.adminExec(`drop trigger test_fail_tx on public.token_transactions; drop function public.test_fail_tx();`);
    }
    expect(await balance(f.roomId, f.ownerId)).toBe(10);
    expect(await balance(f.roomId, f.memberId)).toBe(10);
    expect(await db.admin(`select * from question_unlocks where session_id = $1`, [f.sessionId])).toEqual([]);
  });
});

describe("토큰 선물", () => {
  it("같은 양만큼 이전되고, 같은 요청 ID는 한 번만 처리된다", async () => {
    expect(await db.rpc(f.ownerId, "send_gift", [f.sessionId, 2, "req-12345678"])).toEqual({ duplicate: false, balance: 8 });
    expect(await db.rpc(f.ownerId, "send_gift", [f.sessionId, 2, "req-12345678"])).toEqual({ duplicate: true, balance: 8 });
    expect(await balance(f.roomId, f.ownerId)).toBe(8);
    expect(await balance(f.roomId, f.memberId)).toBe(12);
  });

  it("요청 ID 중복은 데이터베이스 제약으로도 막힌다", async () => {
    await db.rpc(f.ownerId, "send_gift", [f.sessionId, 1, "req-unique-1"]);
    const err = await errorOf(
      db.admin(
        `insert into token_transactions (room_id, session_id, sender_id, recipient_id, amount, type, idempotency_key)
         values ($1, $2, $3, $4, 1, 'gift', 'req-unique-1')`,
        [f.roomId, f.sessionId, f.ownerId, f.memberId],
      ),
    );
    expect(err.message).toMatch(/duplicate key/);
  });

  it("범위 밖 수량, 잔액 부족, 선물 비활성은 거절된다", async () => {
    expect((await errorOf(db.rpc(f.ownerId, "send_gift", [f.sessionId, 99, "req-aaaaaaaa"]))).message).toBe("VALIDATION");
    await db.admin(`update wallets set balance = 0 where room_id = $1 and user_id = $2`, [f.roomId, f.ownerId]);
    expect((await errorOf(db.rpc(f.ownerId, "send_gift", [f.sessionId, 1, "req-bbbbbbbb"]))).message).toBe("INSUFFICIENT_BALANCE");
    await db.admin(`update room_settings set gifts_enabled = false where room_id = $1`, [f.roomId]);
    expect((await errorOf(db.rpc(f.memberId, "send_gift", [f.sessionId, 1, "req-cccccccc"]))).message).toBe("GIFTS_DISABLED");
  });
});

describe("독대 종료", () => {
  it("한쪽만 종료하면 닫히지 않지만 모든 거래가 막히고, 철회하면 다시 가능하다", async () => {
    expect(await db.rpc(f.ownerId, "vote_end_session", [f.sessionId])).toEqual({ closed: false, roomId: f.roomId });
    const rows = await db.admin<{ status: string }>(`select status from pair_sessions where id = $1`, [f.sessionId]);
    expect(rows[0].status).toBe("active");
    expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3]))).message).toBe("SESSION_ENDING");
    expect((await errorOf(db.rpc(f.memberId, "send_gift", [f.sessionId, 1, "req-dddddddd"]))).message).toBe("SESSION_ENDING");
    await db.rpc(f.memberId, "cancel_end_vote", [f.sessionId]);
    expect((await db.rpc<{ alreadyUnlocked: boolean }>(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3])).alreadyUnlocked).toBe(false);
  });

  it("보관 0일이면 양쪽 동의 즉시 독대 기록이 삭제되고 지갑은 유지된다", async () => {
    await db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3]);
    await db.rpc(f.ownerId, "vote_end_session", [f.sessionId]);
    expect(await db.rpc(f.memberId, "vote_end_session", [f.sessionId])).toEqual({ closed: true, roomId: f.roomId });
    expect(await db.admin(`select * from pair_sessions where id = $1`, [f.sessionId])).toEqual([]);
    expect(await db.admin(`select * from question_unlocks where session_id = $1`, [f.sessionId])).toEqual([]);
    expect(await db.admin(`select * from token_transactions where session_id = $1`, [f.sessionId])).toEqual([]);
    expect(await balance(f.roomId, f.ownerId)).toBe(7);
    expect((await errorOf(db.rpc(f.ownerId, "get_session_view", [f.sessionId]))).message).toBe("NOT_FOUND");
  });

  it("종료된 독대에서는 결제할 수 없고, 보관 기간이 지나면 정리 작업이 삭제한다", async () => {
    await db.admin(`update room_settings set session_retention_days = 3 where room_id = $1`, [f.roomId]);
    await db.rpc(f.ownerId, "vote_end_session", [f.sessionId]);
    await db.rpc(f.memberId, "vote_end_session", [f.sessionId]);
    expect((await errorOf(db.rpc(f.ownerId, "unlock_question", [f.sessionId, f.questionId, 3]))).message).toBe("SESSION_NOT_ACTIVE");
    await db.admin(`update pair_sessions set purge_at = now() - interval '1 minute' where id = $1`, [f.sessionId]);
    await db.as({ role: "service_role" }, `select public.run_maintenance()`);
    await db.as({ role: "service_role" }, `select public.run_maintenance()`);
    expect(await db.admin(`select * from pair_sessions where id = $1`, [f.sessionId])).toEqual([]);
  });

  it("정리 작업은 service_role만 실행할 수 있다", async () => {
    expect((await errorOf(db.rpc(f.ownerId, "run_maintenance"))).message).toMatch(/permission denied/);
  });

  it("같은 두 사람 사이 중복 독대와 상태 위반 전환은 거절된다", async () => {
    expect((await errorOf(db.rpc(f.memberId, "request_session", [f.roomId, f.ownerId]))).message).toBe("SESSION_DUPLICATE");
    expect((await errorOf(db.rpc(f.memberId, "respond_to_session", [f.sessionId, true]))).message).toBe("INVALID_STATE");
    const dup = await errorOf(
      db.admin(`insert into pair_sessions (room_id, requester_id, recipient_id, expires_at) values ($1, $2, $3, now() + interval '1 hour')`, [
        f.roomId,
        f.memberId,
        f.ownerId,
      ]),
    );
    expect(dup.message).toMatch(/duplicate key/);
  });

  it("만료된 요청은 수락할 수 없다", async () => {
    await db.rpc(f.outsiderId, "join_room", [f.inviteCode, "씨"]);
    const { sessionId } = await db.rpc<{ sessionId: string }>(f.outsiderId, "request_session", [f.roomId, f.memberId]);
    await db.admin(`update pair_sessions set expires_at = now() - interval '1 minute' where id = $1`, [sessionId]);
    expect((await errorOf(db.rpc(f.memberId, "respond_to_session", [sessionId, true]))).message).toBe("SESSION_EXPIRED");
  });

  it("동시 진행 독대 수 제한을 넘겨 수락할 수 없다", async () => {
    await db.rpc(f.outsiderId, "join_room", [f.inviteCode, "씨"]);
    const { sessionId } = await db.rpc<{ sessionId: string }>(f.outsiderId, "request_session", [f.roomId, f.memberId]);
    expect((await errorOf(db.rpc(f.memberId, "respond_to_session", [sessionId, true]))).message).toBe("SESSION_LIMIT");
  });
});

describe("모임 종료", () => {
  it("보관 0일이면 모임 데이터가 즉시 삭제되고 같은 코드로 가입할 수 없다", async () => {
    await db.rpc(f.ownerId, "close_room", [f.roomId]);
    for (const table of ["rooms", "room_members", "member_questions", "wallets", "pair_sessions", "token_transactions"]) {
      const col = table === "rooms" ? "id" : "room_id";
      expect(await db.admin(`select 1 from ${table} where ${col} = $1`, [f.roomId]), table).toEqual([]);
    }
    expect(await db.admin(`select 1 from member_question_answers where question_id = $1`, [f.questionId])).toEqual([]);
    expect((await errorOf(db.rpc(f.outsiderId, "join_room", [f.inviteCode, "씨"]))).message).toBe("INVALID_INVITE_CODE");
  });

  it("보관 기간이 있으면 새 참여·독대·거래가 막히고 기간 뒤 정리된다", async () => {
    await db.admin(`update room_settings set room_retention_days = 3 where room_id = $1`, [f.roomId]);
    await db.rpc(f.ownerId, "close_room", [f.roomId]);
    expect((await errorOf(db.rpc(f.outsiderId, "join_room", [f.inviteCode, "씨"]))).message).toBe("ROOM_CLOSED");
    expect((await errorOf(db.rpc(f.memberId, "request_session", [f.roomId, f.ownerId]))).message).toBe("ROOM_CLOSED");
    expect((await errorOf(db.rpc(f.ownerId, "send_gift", [f.sessionId, 1, "req-eeeeeeee"]))).message).toBe("ROOM_CLOSED");
    await db.admin(`update rooms set purge_at = now() - interval '1 minute' where id = $1`, [f.roomId]);
    await db.as({ role: "service_role" }, `select public.run_maintenance()`);
    expect(await db.admin(`select 1 from rooms where id = $1`, [f.roomId])).toEqual([]);
  });
});

describe("Realtime publication", () => {
  it("wallets는 publication에 없고(참여자 ID 노출 방지) 화면 갱신용 테이블만 들어 있다", async () => {
    const rows = await db.admin<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(["pair_sessions", "question_unlocks", "token_transactions"]);
  });
});

describe("참여자 목록 비공개", () => {
  /** 씨(C)를 가입시키고 첫 질문에 답변하게 한 뒤 질문 ID를 돌려준다 */
  async function joinOutsiderWithAnswer() {
    await db.rpc(f.outsiderId, "join_room", [f.inviteCode, "씨"]);
    const editor = await db.rpc<ProfileEditor>(f.outsiderId, "get_profile_editor", [f.roomId]);
    await db.rpc(f.outsiderId, "update_profile", [
      f.roomId,
      "씨",
      JSON.stringify(editor.questions.map((q, i) => ({ id: q.id, answer: i === 0 ? "C의 답변" : "", tokenCost: 1, isEnabled: true }))),
    ]);
    return editor.questions[0].id;
  }
  const hideMembers = () => db.admin(`update room_settings set member_list_visible = false where room_id = $1`, [f.roomId]);
  const owners = async (uid: string) =>
    (
      await db.as<{ owner_id: string }>(
        { role: "authenticated", uid },
        `select distinct owner_id from public.member_questions where room_id = $1 order by owner_id`,
        [f.roomId],
      )
    ).map((r) => r.owner_id);

  it("공개 모임에서는 기존처럼 다른 참여자의 공개 질문이 보인다", async () => {
    await joinOutsiderWithAnswer();
    expect(await owners(f.outsiderId)).toContain(f.memberId);
  });

  it("비공개면 일반 참여자는 질문 메타데이터로 다른 참여자 ID를 알아낼 수 없다", async () => {
    await joinOutsiderWithAnswer();
    await hideMembers();
    expect(await owners(f.outsiderId)).toEqual([f.outsiderId]);
    expect((await errorOf(db.rpc(f.outsiderId, "get_member_profile", [f.roomId, f.memberId]))).message).toBe("NOT_FOUND");
  });

  it("비공개면 다른 경로로 알아낸 ID로도 독대를 요청할 수 없다", async () => {
    await joinOutsiderWithAnswer();
    await hideMembers();
    await db.admin(`update room_settings set max_active_sessions_per_member = 3 where room_id = $1`, [f.roomId]);
    expect((await errorOf(db.rpc(f.outsiderId, "request_session", [f.roomId, f.memberId]))).message).toBe("NOT_FOUND");
    expect((await errorOf(db.rpc(f.outsiderId, "request_session", [f.roomId, f.ownerId]))).message).toBe("NOT_FOUND");
    const sessions = await db.admin(`select 1 from pair_sessions where room_id = $1 and requester_id = $2`, [f.roomId, f.outsiderId]);
    expect(sessions).toEqual([]);
  });

  it("비공개여도 운영자는 참여자의 질문을 보고 독대를 요청할 수 있다", async () => {
    await joinOutsiderWithAnswer();
    await hideMembers();
    await db.admin(`update room_settings set max_active_sessions_per_member = 3 where room_id = $1`, [f.roomId]);
    expect(await owners(f.ownerId)).toEqual([f.ownerId, f.memberId, f.outsiderId].sort());
    const { sessionId } = await db.rpc<{ sessionId: string }>(f.ownerId, "request_session", [f.roomId, f.outsiderId]);
    expect(sessionId).toBeTruthy();
  });

  it("비공개여도 이미 독대한 상대와는 질문 공개·수락·열기·재요청이 그대로 된다", async () => {
    const outsiderQuestion = await joinOutsiderWithAnswer();
    await db.admin(`update room_settings set max_active_sessions_per_member = 3 where room_id = $1`, [f.roomId]);
    // 목록이 공개일 때 C가 B에게 요청해 둔 상태에서 비공개로 전환
    const { sessionId } = await db.rpc<{ sessionId: string }>(f.outsiderId, "request_session", [f.roomId, f.memberId]);
    await hideMembers();

    expect(await owners(f.memberId)).toEqual([f.memberId, f.outsiderId].sort());
    expect(await owners(f.outsiderId)).toEqual([f.memberId, f.outsiderId].sort());
    await db.rpc(f.memberId, "respond_to_session", [sessionId, true]);
    const view = await db.rpc<SessionView>(f.memberId, "get_session_view", [sessionId]);
    expect(view.partner.nickname).toBe("씨");
    expect(view.partnerQuestions.map((q) => q.meta.id)).toEqual([outsiderQuestion]);
    expect((await db.rpc<{ alreadyUnlocked: boolean }>(f.memberId, "unlock_question", [sessionId, outsiderQuestion, 1])).alreadyUnlocked).toBe(false);

    // 종료 후(보관 기간 중) 같은 상대에게 다시 요청할 수 있다
    await db.admin(`update room_settings set session_retention_days = 3 where room_id = $1`, [f.roomId]);
    await db.rpc(f.memberId, "vote_end_session", [sessionId]);
    await db.rpc(f.outsiderId, "vote_end_session", [sessionId]);
    const again = await db.rpc<{ sessionId: string }>(f.outsiderId, "request_session", [f.roomId, f.memberId]);
    expect(again.sessionId).toBeTruthy();
  });
});
