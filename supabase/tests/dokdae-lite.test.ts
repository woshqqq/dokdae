import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, errorOf } from "./harness";

// 독대 라이트(dd_*) 마이그레이션 검증: 서버(service_role)만 함수를 호출할 수 있고,
// 상대의 소개·답변은 reviewing/active 독대의 당사자에게만 내려가는지 확인한다.

let db: TestDb;

beforeAll(async () => {
  db = await TestDb.create();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const SERVER = { role: "service_role" } as const;
let seq = 0;
const hash = () => (++seq).toString(16).padStart(64, "0");
const code = () => `ROOM${String(++seq).padStart(4, "0")}`;

async function call<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.as<{ r: T }>(SERVER, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0]?.r as T;
}

interface Person {
  id: string;
  hash: string;
}

async function createRoom(nickname = "방장") {
  const h = hash();
  const c = code();
  const out = await call<{ room_id: string; participant_id: string }>("dd_create_room", "테스트 방", c, h, nickname);
  return { roomId: out.room_id, code: c, owner: { id: out.participant_id, hash: h } as Person };
}

async function join(c: string, nickname: string): Promise<Person & { roomId: string }> {
  const h = hash();
  const out = await call<{ room_id: string; participant_id: string }>("dd_join_room", c, h, nickname);
  return { id: out.participant_id, hash: h, roomId: out.room_id };
}

/** 개인 질문 5개를 추가하고(기본 5개와 합쳐 10개) 준비 완료로 만든다. */
async function makeReady(p: Person, answer?: string) {
  for (let i = 0; i < 5; i++) await call("dd_add_question", p.id, `개인 질문 ${i + 1}`);
  if (answer) {
    const { questions } = await call<{ questions: { id: string; kind: string }[] }>("dd_my_questions", p.id);
    await call("dd_save_answer", p.id, questions[0].id, answer);
  }
  await call("dd_mark_ready", p.id);
}

async function twoReady() {
  const room = await createRoom("에이");
  const b = await join(room.code, "비");
  await makeReady(room.owner, "A의 비밀 답변");
  await makeReady(b, "B의 비밀 답변");
  return { ...room, a: room.owner, b };
}

describe("접근 통제", () => {
  it("anon·authenticated 는 dd_ 테이블을 읽거나 쓸 수 없다", async () => {
    const { roomId } = await createRoom();
    for (const role of ["anon", "authenticated"] as const) {
      for (const table of ["dd_rooms", "dd_participants", "dd_questions", "dd_answers", "dd_pairs", "dd_settings"]) {
        const err = await errorOf(db.as({ role }, `select * from public.${table}`));
        expect(err.message).toMatch(/permission denied/);
      }
      const err = await errorOf(db.as({ role }, `insert into public.dd_rooms (name, invite_code) values ('x', 'ABCD1234')`));
      expect(err.message).toMatch(/permission denied/);
    }
    expect(roomId).toBeTruthy();
  });

  it("anon·authenticated 는 dd_ 함수를 실행할 수 없다", async () => {
    const room = await createRoom();
    for (const role of ["anon", "authenticated"] as const) {
      const err = await errorOf(db.as({ role }, `select public.dd_overview($1)`, [room.owner.id]));
      expect(err.message).toMatch(/permission denied/);
      const err2 = await errorOf(db.as({ role }, `select public.dd_authenticate($1, $2)`, [room.roomId, room.owner.hash]));
      expect(err2.message).toMatch(/permission denied/);
    }
  });

  it("모든 dd_ 테이블에 RLS가 켜져 있다", async () => {
    const rows = await db.admin<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname like 'dd\\_%' and relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });
});

describe("방 생성·입장·인증", () => {
  it("토큰 해시로만 참가자를 인증하고, 다른 방 ID로는 인증되지 않는다", async () => {
    const r1 = await createRoom();
    const r2 = await createRoom();
    expect(await call("dd_authenticate", r1.roomId, r1.owner.hash)).toMatchObject({ id: r1.owner.id, is_creator: true });
    expect(await call("dd_authenticate", r1.roomId, hash())).toBeNull();
    expect(await call("dd_authenticate", r2.roomId, r1.owner.hash)).toBeNull();
  });

  it("DB에는 토큰 원문이 아닌 해시만 저장된다", async () => {
    const r = await createRoom();
    const rows = await db.admin<{ token_hash: string }>(`select token_hash from dd_participants where id = $1`, [r.owner.id]);
    expect(rows[0].token_hash).toBe(r.owner.hash);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("잘못된 초대 코드와 중복 닉네임은 거절한다", async () => {
    const r = await createRoom("에이");
    expect((await errorOf(call("dd_join_room", "ZZZZ9999", hash(), "누구"))).message).toBe("INVALID_CODE");
    expect((await errorOf(call("dd_join_room", r.code, hash(), "에이"))).message).toBe("NICKNAME_TAKEN");
    expect((await errorOf(call("dd_join_room", r.code, hash(), "  "))).message).toBe("VALIDATION");
  });

  it("개요에는 초대 코드가 방 생성자에게만 보이고 참가자 목록에는 소개·답변이 없다", async () => {
    const r = await createRoom("에이");
    const b = await join(r.code, "비");
    const ownerView = await call<{ room: { invite_code: string | null }; members: Record<string, unknown>[] }>("dd_overview", r.owner.id);
    const memberView = await call<{ room: { invite_code: string | null }; members: Record<string, unknown>[] }>("dd_overview", b.id);
    expect(ownerView.room.invite_code).toBe(r.code);
    expect(memberView.room.invite_code).toBeNull();
    expect(Object.keys(ownerView.members[0]).sort()).toEqual(["has_photo", "id", "is_creator", "nickname", "pair", "ready"]);
    expect(JSON.stringify(memberView)).not.toContain(r.owner.hash);
  });

  it("다른 방 참가자는 서로의 목록에 보이지 않는다", async () => {
    const r1 = await createRoom("에이");
    const r2 = await createRoom("씨");
    const view = await call<{ members: unknown[] }>("dd_overview", r2.owner.id);
    expect(view.members).toEqual([]);
    expect(r1.owner.id).not.toBe(r2.owner.id);
  });
});

describe("질문 구성", () => {
  it("기본 질문 5개가 시드되어 있고 10개 미만이면 준비 완료할 수 없다", async () => {
    const r = await createRoom();
    const q = await call<{ total: number; min_questions: number; questions: { kind: string; title: string }[] }>("dd_my_questions", r.owner.id);
    expect(q.total).toBe(5);
    expect(q.min_questions).toBe(10);
    expect(q.questions.map((x) => x.title)).toEqual(["지금의 나", "알아줬으면 하는 나", "잘 드러나지 않는 나", "나를 둘러싼 환경", "이해받고 싶은 나"]);
    expect((await errorOf(call("dd_mark_ready", r.owner.id))).message).toBe("MIN_QUESTIONS");
    for (let i = 0; i < 4; i++) await call("dd_add_question", r.owner.id, `질문 ${i}`);
    expect((await errorOf(call("dd_mark_ready", r.owner.id))).message).toBe("MIN_QUESTIONS");
    await call("dd_add_question", r.owner.id, "다섯째");
    await call("dd_mark_ready", r.owner.id);
    expect((await call<{ ready: boolean }>("dd_my_questions", r.owner.id)).ready).toBe(true);
  });

  it("준비를 마친 뒤에는 최소 개수 아래로 개인 질문을 지울 수 없다", async () => {
    const r = await createRoom();
    await makeReady(r.owner);
    const { questions } = await call<{ questions: { id: string; kind: string }[] }>("dd_my_questions", r.owner.id);
    const personal = questions.find((q) => q.kind === "personal")!;
    expect((await errorOf(call("dd_delete_question", r.owner.id, personal.id))).message).toBe("MIN_QUESTIONS");
    await call("dd_add_question", r.owner.id, "여섯째");
    await call("dd_delete_question", r.owner.id, personal.id);
  });

  it("답변은 질문 ID에 저장되고, 비우면 건너뛴 것으로 지워진다", async () => {
    const r = await createRoom();
    const { questions } = await call<{ questions: { id: string }[] }>("dd_my_questions", r.owner.id);
    await call("dd_save_answer", r.owner.id, questions[1].id, "답변");
    await call("dd_save_answer", r.owner.id, questions[1].id, "수정된 답변");
    let now = await call<{ questions: { id: string; answer: string | null }[] }>("dd_my_questions", r.owner.id);
    expect(now.questions[1].answer).toBe("수정된 답변");
    expect(now.questions[0].answer).toBeNull();
    await call("dd_save_answer", r.owner.id, questions[1].id, "  ");
    now = await call("dd_my_questions", r.owner.id);
    expect(now.questions[1].answer).toBeNull();
  });

  it("관리자가 기본 질문 문구를 바꿔도 기존 답변은 같은 질문에 남는다", async () => {
    const r = await createRoom();
    const { questions } = await call<{ questions: { id: string }[] }>("dd_my_questions", r.owner.id);
    await call("dd_save_answer", r.owner.id, questions[2].id, "내 답변");
    await db.admin(`update dd_questions set title = '바뀐 제목', body = '바뀐 질문', position = 99 where id = $1`, [questions[2].id]);
    const now = await call<{ questions: { id: string; title: string; answer: string | null }[] }>("dd_my_questions", r.owner.id);
    const moved = now.questions.find((q) => q.id === questions[2].id)!;
    expect(moved).toMatchObject({ title: "바뀐 제목", answer: "내 답변" });
    expect(now.questions[now.questions.length - 1].id).toBe(questions[2].id);
  });

  it("다른 참가자의 개인 질문에는 답하거나 수정·삭제할 수 없다", async () => {
    const r = await createRoom("에이");
    const b = await join(r.code, "비");
    const qid = await call<string>("dd_add_question", r.owner.id, "에이만의 질문");
    expect((await errorOf(call("dd_save_answer", b.id, qid, "가로채기"))).message).toBe("NOT_FOUND");
    expect((await errorOf(call("dd_update_question", b.id, qid, "변조"))).message).toBe("NOT_FOUND");
    expect((await errorOf(call("dd_delete_question", b.id, qid))).message).toBe("NOT_FOUND");
    const bq = await call<{ questions: { id: string }[] }>("dd_my_questions", b.id);
    expect(bq.questions.some((q) => q.id === qid)).toBe(false);
  });

  it("너무 긴 답변은 거절한다", async () => {
    const r = await createRoom();
    const { questions } = await call<{ questions: { id: string }[] }>("dd_my_questions", r.owner.id);
    expect((await errorOf(call("dd_save_answer", r.owner.id, questions[0].id, "가".repeat(2001)))).message).toBe("VALIDATION");
  });
});

describe("독대와 열람 권한", () => {
  it("요청만 있거나 요청 전에는 상대의 소개·답변이 내려가지 않는다", async () => {
    const t = await twoReady();
    const pairId = await call<string>("dd_request_pair", t.a.id, t.b.id);
    for (const viewer of [t.a, t.b]) {
      const view = await call<{ pair: { status: string }; peer: { bio: string | null; answers: unknown } }>("dd_view_pair", viewer.id, pairId);
      expect(view.pair.status).toBe("requested");
      expect(view.peer.bio).toBeNull();
      expect(view.peer.answers).toBeNull();
    }
  });

  it("수락(reviewing) 후에는 서로의 답변이 보이고, 양쪽 동의 전에는 active 가 아니다", async () => {
    const t = await twoReady();
    const pairId = await call<string>("dd_request_pair", t.a.id, t.b.id);
    expect(await call("dd_respond_pair", t.b.id, pairId, true)).toBe("reviewing");
    const aSees = await call<{ peer: { answers: { answer: string | null }[] } }>("dd_view_pair", t.a.id, pairId);
    const bSees = await call<{ peer: { answers: { answer: string | null }[] } }>("dd_view_pair", t.b.id, pairId);
    expect(aSees.peer.answers[0].answer).toBe("B의 비밀 답변");
    expect(bSees.peer.answers[0].answer).toBe("A의 비밀 답변");

    expect(await call("dd_consent", t.a.id, pairId)).toBe("reviewing");
    expect(await call("dd_consent", t.a.id, pairId)).toBe("reviewing"); // 재호출해도 시작되지 않음
    let row = (await db.admin<{ status: string }>(`select status from dd_pairs where id = $1`, [pairId]))[0];
    expect(row.status).toBe("reviewing");
    expect(await call("dd_consent", t.b.id, pairId)).toBe("active");
    row = (await db.admin<{ status: string }>(`select status from dd_pairs where id = $1`, [pairId]))[0];
    expect(row.status).toBe("active");
  });

  it("요청자는 스스로 수락할 수 없고, 제3자는 독대를 볼 수도 없다", async () => {
    const t = await twoReady();
    const c = await join(t.code, "씨");
    await makeReady(c, "C의 비밀 답변");
    const pairId = await call<string>("dd_request_pair", t.a.id, t.b.id);
    expect((await errorOf(call("dd_respond_pair", t.a.id, pairId, true))).message).toBe("NOT_FOUND");
    expect((await errorOf(call("dd_respond_pair", c.id, pairId, true))).message).toBe("NOT_FOUND");
    await call("dd_respond_pair", t.b.id, pairId, true);
    expect((await errorOf(call("dd_view_pair", c.id, pairId))).message).toBe("NOT_FOUND");
    expect((await errorOf(call("dd_consent", c.id, pairId))).message).toBe("NOT_FOUND");
    expect((await errorOf(call("dd_end_pair", c.id, pairId))).message).toBe("NOT_FOUND");
  });

  it("독대가 끝나면 상대의 소개·답변이 다시 가려진다", async () => {
    const t = await twoReady();
    const pairId = await call<string>("dd_request_pair", t.a.id, t.b.id);
    await call("dd_respond_pair", t.b.id, pairId, true);
    await call("dd_consent", t.a.id, pairId);
    await call("dd_consent", t.b.id, pairId);
    expect(await call("dd_end_pair", t.a.id, pairId)).toBe("closed");
    expect(await call("dd_end_pair", t.a.id, pairId)).toBe("closed"); // 멱등
    const view = await call<{ pair: { status: string }; peer: { bio: string | null; answers: unknown } }>("dd_view_pair", t.b.id, pairId);
    expect(view.pair.status).toBe("closed");
    expect(view.peer.bio).toBeNull();
    expect(view.peer.answers).toBeNull();
    // 기록은 보존된다
    const rows = await db.admin<{ status: string; closed_by: string }>(`select status, closed_by from dd_pairs where id = $1`, [pairId]);
    expect(rows[0]).toEqual({ status: "closed", closed_by: t.a.id });
  });

  it("거절된 요청은 수락·동의할 수 없고, 거절 후 다시 요청할 수 있다", async () => {
    const t = await twoReady();
    const pairId = await call<string>("dd_request_pair", t.a.id, t.b.id);
    expect(await call("dd_respond_pair", t.b.id, pairId, false)).toBe("declined");
    expect((await errorOf(call("dd_respond_pair", t.b.id, pairId, true))).message).toBe("INVALID_STATE");
    expect((await errorOf(call("dd_consent", t.a.id, pairId))).message).toBe("INVALID_STATE");
    const again = await call<string>("dd_request_pair", t.b.id, t.a.id);
    expect(again).not.toBe(pairId);
  });

  it("같은 두 사람 사이에 진행 중인 독대를 중복해서 만들 수 없다(방향 무관)", async () => {
    const t = await twoReady();
    await call("dd_request_pair", t.a.id, t.b.id);
    expect((await errorOf(call("dd_request_pair", t.a.id, t.b.id))).message).toBe("PAIR_EXISTS");
    expect((await errorOf(call("dd_request_pair", t.b.id, t.a.id))).message).toBe("PAIR_EXISTS");
  });

  it("준비를 마치지 않았거나 다른 방 참가자와는 독대할 수 없다", async () => {
    const r = await createRoom("에이");
    const b = await join(r.code, "비");
    await makeReady(r.owner);
    expect((await errorOf(call("dd_request_pair", r.owner.id, b.id))).message).toBe("PEER_NOT_READY");
    expect((await errorOf(call("dd_request_pair", b.id, r.owner.id))).message).toBe("NOT_READY");
    const other = await createRoom("타방");
    await makeReady(other.owner);
    expect((await errorOf(call("dd_request_pair", r.owner.id, other.owner.id))).message).toBe("NOT_FOUND");
    expect((await errorOf(call("dd_request_pair", r.owner.id, r.owner.id))).message).toBe("NOT_FOUND");
  });

  it("이미 진행 중인 독대가 있으면 다른 독대를 수락할 수 없다", async () => {
    const t = await twoReady();
    const c = await join(t.code, "씨");
    await makeReady(c);
    const p1 = await call<string>("dd_request_pair", t.a.id, t.b.id);
    await call("dd_respond_pair", t.b.id, p1, true);
    const p2 = await call<string>("dd_request_pair", c.id, t.b.id);
    expect((await errorOf(call("dd_respond_pair", t.b.id, p2, true))).message).toBe("BUSY");
    await call("dd_end_pair", t.a.id, p1);
    expect(await call("dd_respond_pair", t.b.id, p2, true)).toBe("reviewing");
  });

  it("active 상태는 양쪽 동의 없이는 DB 제약으로도 만들 수 없다", async () => {
    const t = await twoReady();
    const pairId = await call<string>("dd_request_pair", t.a.id, t.b.id);
    const err = await errorOf(db.admin(`update dd_pairs set status = 'active' where id = $1`, [pairId]));
    expect(err.message).toMatch(/violates check constraint/);
  });
});

describe("사진 접근", () => {
  it("같은 방 참가자만 사진 경로를 받을 수 있다", async () => {
    const r = await createRoom("에이");
    const b = await join(r.code, "비");
    const other = await createRoom("타방");
    expect(await call("dd_set_photo", b.id, `${r.roomId}/${b.id}/abc.jpg`)).toBeNull();
    expect(await call("dd_photo_path", r.owner.id, b.id)).toBe(`${r.roomId}/${b.id}/abc.jpg`);
    expect(await call("dd_photo_path", other.owner.id, b.id)).toBeNull();
    expect(await call("dd_set_photo", b.id, `${r.roomId}/${b.id}/def.jpg`)).toBe(`${r.roomId}/${b.id}/abc.jpg`);
  });
});
