import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, errorOf } from "./harness";

// Publishable Key(anon 역할)만으로 쓰는 공개 API(dd_api_*) 검증: 참가자 토큰을 모르면 아무것도 할 수 없다.

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const ANON = { role: "anon" } as const;
let seq = 0;
const code = () => `API${String(++seq).padStart(5, "0")}`;
const tok = () => `token-${(++seq).toString(36)}-${"x".repeat(30)}`;

async function api<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.as<{ r: T }>(ANON, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0]?.r as T;
}
const hashOf = async (t: string) => (await db.admin<{ h: string }>(`select public.dd_hash_text($1) as h`, [t]))[0].h;

type Who = { roomId: string; id: string; token: string };

async function room(nickname = "에이"): Promise<Who & { code: string }> {
  const t = tok();
  const c = code();
  const out = await api<{ room_id: string; participant_id: string }>("dd_api_create_room", "방", c, t, nickname);
  return { roomId: out.room_id, id: out.participant_id, token: t, code: c };
}
async function joinApi(c: string, nickname: string): Promise<Who> {
  const t = tok();
  const out = await api<{ room_id: string; participant_id: string }>("dd_api_join_room", c, t, nickname);
  return { roomId: out.room_id, id: out.participant_id, token: t };
}

describe("공개 API(anon, 토큰 기반)", () => {
  it("anon 은 내부 함수와 헬퍼를 호출할 수 없다(참가자 ID 위조 불가)", async () => {
    const r = await room();
    for (const sql of [
      `select public.dd_overview('${r.id}')`,
      `select public.dd_resolve('${r.roomId}', 'x')`,
      `select public.dd_hash_text('x')`,
      `select public.dd_view_pair('${r.id}', '${r.id}')`,
    ]) {
      expect((await errorOf(db.as(ANON, sql))).message).toMatch(/permission denied/);
    }
    for (const t of ["dd_photos", "dd_admin_proof", "dd_participants"]) {
      expect((await errorOf(db.as(ANON, `select * from public.${t}`))).message).toMatch(/permission denied/);
    }
  });

  it("토큰은 해시로만 저장되고, 원문 토큰이 있어야 인증된다", async () => {
    const r = await room();
    const stored = (await db.admin<{ token_hash: string }>(`select token_hash from dd_participants where id = $1`, [r.id]))[0];
    expect(stored.token_hash).toBe(await hashOf(r.token));
    expect(stored.token_hash).not.toBe(r.token);
    expect(await api("dd_api_authenticate", r.roomId, r.token)).toMatchObject({ id: r.id });
    expect(await api("dd_api_authenticate", r.roomId, stored.token_hash)).toBeNull(); // 해시를 토큰으로 쓸 수 없다
    expect(await api("dd_api_authenticate", r.roomId, tok())).toBeNull();
    expect((await errorOf(api("dd_api_overview", r.roomId, tok()))).message).toBe("UNAUTHENTICATED");
    expect((await errorOf(api("dd_api_overview", r.roomId, ""))).message).toBe("UNAUTHENTICATED");
  });

  it("다른 방의 토큰으로는 이 방에서 아무것도 할 수 없다", async () => {
    const r1 = await room("에이");
    const r2 = await room("씨");
    expect((await errorOf(api("dd_api_overview", r1.roomId, r2.token))).message).toBe("UNAUTHENTICATED");
    expect((await errorOf(api("dd_api_mark_ready", r1.roomId, r2.token))).message).toBe("UNAUTHENTICATED");
    expect((await errorOf(api("dd_api_get_photo", r1.roomId, r2.token, r1.id))).message).toBe("UNAUTHENTICATED");
  });

  it("제3자는 독대 답변을 읽을 수 없고, 당사자는 수락 뒤에만 읽으며, 종료 후엔 다시 막힌다", async () => {
    const a = await room("에이");
    const b = await joinApi(a.code, "비");
    const third = await joinApi(a.code, "씨");
    for (const p of [a, b]) {
      for (let i = 0; i < 5; i++) await api("dd_api_add_question", a.roomId, p.token, `질문 ${i}`);
      const { questions } = await api<{ questions: { id: string }[] }>("dd_api_my_questions", a.roomId, p.token);
      await api("dd_api_save_answer", a.roomId, p.token, questions[0].id, p === a ? "A 비밀" : "B 비밀");
      await api("dd_api_mark_ready", a.roomId, p.token);
    }
    const pairId = await api<string>("dd_api_request_pair", a.roomId, a.token, b.id);
    const before = await api<{ peer: { answers: unknown } }>("dd_api_view_pair", a.roomId, b.token, pairId);
    expect(before.peer.answers).toBeNull();
    expect((await errorOf(api("dd_api_view_pair", a.roomId, third.token, pairId))).message).toBe("NOT_FOUND");

    await api("dd_api_respond_pair", a.roomId, b.token, pairId, true);
    const after = await api<{ peer: { answers: { answer: string | null }[] } }>("dd_api_view_pair", a.roomId, a.token, pairId);
    expect(after.peer.answers[0].answer).toBe("B 비밀");
    expect((await errorOf(api("dd_api_view_pair", a.roomId, third.token, pairId))).message).toBe("NOT_FOUND");

    await api("dd_api_consent", a.roomId, a.token, pairId);
    expect(await api("dd_api_consent", a.roomId, b.token, pairId)).toBe("active");
    await api("dd_api_end_pair", a.roomId, a.token, pairId);
    const closed = await api<{ peer: { answers: unknown; bio: unknown } }>("dd_api_view_pair", a.roomId, b.token, pairId);
    expect(closed.peer.answers).toBeNull();
    expect(closed.peer.bio).toBeNull();
  });

  it("사진: 형식·크기를 DB에서도 검증하고 같은 방 참가자만 볼 수 있다", async () => {
    const a = await room("에이");
    const b = await joinApi(a.code, "비");
    const other = await room("타방");
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 1)]);

    const bad = (mime: string, data: Buffer) => errorOf(api("dd_api_set_photo", a.roomId, a.token, mime, new Uint8Array(data)));
    expect((await bad("image/jpeg", Buffer.from("<svg onload=1>"))).message).toBe("PHOTO_INVALID");
    expect((await bad("image/png", jpeg)).message).toBe("PHOTO_INVALID");
    expect((await bad("image/gif", jpeg)).message).toBe("PHOTO_INVALID");
    expect((await bad("image/jpeg", Buffer.concat([jpeg, Buffer.alloc(1_048_576)]))).message).toBe("PHOTO_INVALID");

    await api("dd_api_set_photo", a.roomId, a.token, "image/jpeg", new Uint8Array(jpeg));
    const got = await api<{ mime: string; data: string }>("dd_api_get_photo", a.roomId, b.token, a.id);
    expect(got.mime).toBe("image/jpeg");
    expect(Buffer.from(got.data, "base64").equals(jpeg)).toBe(true);
    expect(await api("dd_api_get_photo", a.roomId, b.token, b.id)).toBeNull(); // 사진 없음
    expect(await api("dd_api_get_photo", other.roomId, other.token, a.id)).toBeNull(); // 다른 방 참가자의 사진은 못 봄
    expect((await errorOf(api("dd_api_get_photo", a.roomId, other.token, a.id))).message).toBe("UNAUTHENTICATED");
    const ov = await api<{ members: { id: string; has_photo: boolean }[] }>("dd_api_overview", a.roomId, b.token);
    expect(ov.members.find((m) => m.id === a.id)!.has_photo).toBe(true);
  });

  it("관리자 질문 수정: 증명 미등록이면 거절, 맞는 증명만 허용, 반복 실패는 잠금", async () => {
    const qid = "00000000-0000-4000-8000-0000000000a1";
    const proof = "p".repeat(64);
    const edit = (p: string, id = qid) => api<string>("dd_api_admin_update_question", p, id, "수정 제목", "수정 본문", "설명", 1);
    expect(await edit(proof)).toBe("denied"); // 등록 전에는 항상 거절
    await db.admin(`insert into dd_admin_proof (proof_hash) values ($1)`, [await hashOf(proof)]);
    expect(await edit("wrong")).toBe("denied");
    expect(await edit(proof)).toBe("ok");
    expect((await db.admin<{ title: string }>(`select title from dd_questions where id = $1`, [qid]))[0].title).toBe("수정 제목");
    expect(await edit(proof, "00000000-0000-4000-8000-0000000000ff")).toBe("not_found");
    // 개인 질문은 관리자 API로 바꿀 수 없다
    const r = await room();
    const personal = await api<string>("dd_api_add_question", r.roomId, r.token, "개인");
    expect(await edit(proof, personal)).toBe("not_found");
    for (let i = 0; i < 10; i++) await edit("wrong");
    expect(await edit(proof)).toBe("locked");
    expect(await api<unknown[]>("dd_api_default_questions")).toHaveLength(5);
  });
});
