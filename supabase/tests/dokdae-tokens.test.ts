import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TestDb, errorOf } from "./harness";

// 토큰 시스템(20261025000003): 지갑·항목·열람·보상. 모든 호출은 anon 역할(Publishable Key)의 dd_api_* 함수로 한다.

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const ANON = { role: "anon" } as const;
let seq = 0;
const code = () => `TKN${String(++seq).padStart(5, "0")}`;
const tok = () => `tok-${(++seq).toString(36)}-${"x".repeat(30)}`;

async function api<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.as<{ r: T }>(ANON, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0]?.r as T;
}
const fails = async (fn: string, ...args: unknown[]) => (await errorOf(api(fn, ...args))).message;
const sql = <T = Record<string, unknown>>(q: string, p: unknown[] = []) => db.admin<T>(q, p);

type Who = { room: string; id: string; t: string };
async function newRoom(nickname = "에이"): Promise<Who & { code: string }> {
  const t = tok();
  const c = code();
  const o = await api<{ room_id: string; participant_id: string }>("dd_api_create_room", "방", c, t, nickname);
  return { room: o.room_id, id: o.participant_id, t, code: c };
}
async function join(c: string, nickname: string): Promise<Who> {
  const t = tok();
  const o = await api<{ room_id: string; participant_id: string }>("dd_api_join_room", c, t, nickname);
  return { room: o.room_id, id: o.participant_id, t };
}
async function trio() {
  const a = await newRoom("에이");
  const b = await join(a.code, "비");
  const c = await join(a.code, "씨");
  return { a, b, c };
}
const balance = async (id: string) => (await sql<{ balance: number }>(`select balance from dd_wallets where participant_id = $1`, [id]))[0]?.balance;
const roomTotal = async (room: string) =>
  (await sql<{ s: number }>(`select coalesce(sum(w.balance), 0)::int s from dd_wallets w join dd_participants p on p.id = w.participant_id where p.room_id = $1`, [room]))[0].s;
/** 원장 불변식: 모든 지갑의 잔액 = 받은 거래 합 − 보낸 거래 합 */
async function ledgerMismatches() {
  return (
    await sql<{ n: number }>(`
      select count(*)::int n from dd_wallets w where w.balance <> (
        coalesce((select sum(amount) from dd_token_tx where recipient_id = w.participant_id), 0)
      - coalesce((select sum(amount) from dd_token_tx where sender_id = w.participant_id), 0))`)
  )[0].n;
}
async function addItems(p: Who, n: number, label: string) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await api<string>("dd_api_add_item", p.room, p.t, i % 2 ? "ask" : "tell", `${label} 제목 ${i}`, `${label} 항목 ${i}`, 1 + (i % 3)));
  return ids;
}
async function activePair(a: Who, b: Who) {
  const p = await api<string>("dd_api_request_pair", a.room, a.t, b.id);
  await api("dd_api_respond_pair", b.room, b.t, p, true);
  await api("dd_api_consent", a.room, a.t, p);
  await api("dd_api_consent", b.room, b.t, p);
  return p;
}
type Peer = { balance: number; items: { id: string; ordinal: number; cost: number; unlocked: boolean }[]; opened: Record<string, unknown>[] };
const peer = (viewer: Who, pair: string) => api<Peer>("dd_api_peer_items", viewer.room, viewer.t, pair);
const unlock = (viewer: Who, pair: string, item: string, cost: number) =>
  api<{ already_unlocked: boolean; unlock_id: string; balance: number; kind: string; body: string }>("dd_api_unlock_item", viewer.room, viewer.t, pair, item, cost);

describe("초기 지급: 기존·신규 참가자 모두 정확히 한 번", () => {
  it("방 생성·입장 시 각자 10개를 받고 거래는 참가자당 1건이다", async () => {
    const { a, b, c } = await trio();
    for (const p of [a, b, c]) expect(await balance(p.id)).toBe(10);
    const n = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where type = 'initial_grant' and recipient_id in ($1, $2, $3)`, [a.id, b.id, c.id]);
    expect(n[0].n).toBe(3);
    expect((await api<{ balance: number }>("dd_api_overview", a.room, a.t)).balance).toBe(10);
  });

  it("함수를 거치지 않은 직접 INSERT 도 트리거로 한 번만 지급되고, 지급 함수를 다시 불러도 중복되지 않는다", async () => {
    const a = await newRoom();
    const direct = (await sql<{ id: string }>(`insert into dd_participants (room_id, token_hash, nickname) values ($1, $2, '직접') returning id`, [a.room, "b".repeat(64)]))[0].id;
    expect(await balance(direct)).toBe(10);
    await sql(`select public.dd_grant_initial($1)`, [direct]);
    await sql(`select public.dd_grant_initial($1)`, [direct]);
    expect(await balance(direct)).toBe(10);
    const n = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where type = 'initial_grant' and recipient_id = $1`, [direct]);
    expect(n[0].n).toBe(1);
  });

  it("기존 참가자 백필: 마이그레이션 시점에 이미 있던 참가자도 10개를 한 번만 받는다(재실행 멱등)", async () => {
    // 토큰 마이그레이션 이전 상태를 만든다: 지갑이 없는 기존 참가자
    const a = await newRoom();
    await sql(`delete from dd_token_tx where recipient_id = $1`, [a.id]);
    await sql(`delete from dd_wallets where participant_id = $1`, [a.id]);
    const migration = readFileSync(fileURLToPath(new URL("../migrations/20261025000003_dokdae_tokens.sql", import.meta.url)), "utf8");
    const backfill = migration.slice(migration.indexOf("with ins as"), migration.indexOf("-- 참가자 행이 어떤"));
    expect(backfill).toContain("on conflict (participant_id) do nothing");
    await db.adminExec(backfill);
    await db.adminExec(backfill);
    expect(await balance(a.id)).toBe(10);
    const n = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where type = 'initial_grant' and recipient_id = $1`, [a.id]);
    expect(n[0].n).toBe(1);
    expect(await ledgerMismatches()).toBe(0);
  });
});

describe("항목 등록", () => {
  it("유형·제목·내용·비용(1~3)을 검증하고, 기본 항목 5개를 포함해 최대 10개(직접 추가 5개)까지만 등록할 수 있다", async () => {
    const a = await newRoom();
    for (const cost of [0, 4, null]) expect(await fails("dd_api_add_item", a.room, a.t, "tell", "제목", "내용", cost)).toBe("VALIDATION");
    expect(await fails("dd_api_add_item", a.room, a.t, "bad", "제목", "내용", 1)).toBe("VALIDATION");
    expect(await fails("dd_api_add_item", a.room, a.t, "tell", "제목", "  ", 1)).toBe("VALIDATION");
    expect(await fails("dd_api_add_item", a.room, a.t, "tell", "제목", "가".repeat(501), 1)).toBe("VALIDATION");
    expect(await fails("dd_api_add_item", a.room, a.t, "tell", "  ", "내용", 1)).toBe("VALIDATION"); // 제목 필수
    expect(await fails("dd_api_add_item", a.room, a.t, "tell", "가".repeat(61), "내용", 1)).toBe("VALIDATION");
    await addItems(a, 5, "A");
    expect(await fails("dd_api_add_item", a.room, a.t, "tell", "제목", "6번째", 1)).toBe("ITEM_LIMIT");
  });

  it("남의 항목은 수정·삭제할 수 없고, 다른 방 토큰은 거절된다", async () => {
    const { a, b } = await trio();
    const [item] = await addItems(a, 1, "A");
    expect(await fails("dd_api_update_item", b.room, b.t, item, "tell", "제목", "변조", 1)).toBe("NOT_FOUND");
    expect(await fails("dd_api_delete_item", b.room, b.t, item)).toBe("NOT_FOUND");
    const other = await newRoom("타방");
    expect(await fails("dd_api_my_items", a.room, other.t)).toBe("UNAUTHENTICATED");
  });
});

describe("블라인드: 열람 전에는 개수와 비용만", () => {
  it("requested·reviewing 에서는 목록이 비어 있고 열람이 거절된다", async () => {
    const { a, b } = await trio();
    const ids = await addItems(a, 3, "A");
    const pair = await api<string>("dd_api_request_pair", a.room, a.t, b.id); // 준비 조건 없이 요청
    expect(await fails("dd_api_unlock_item", b.room, b.t, pair, ids[0], 1)).toBe("INVALID_STATE");
    expect((await peer(b, pair)).items).toEqual([]);
    await api("dd_api_respond_pair", b.room, b.t, pair, true);
    expect(await fails("dd_api_unlock_item", b.room, b.t, pair, ids[0], 1)).toBe("INVALID_STATE");
    const reviewing = await peer(b, pair);
    expect(reviewing.items).toEqual([]);
    expect(reviewing.opened).toEqual([]);
    const view = await api<{ peer: { answers: unknown } }>("dd_api_view_pair", b.room, b.t, pair);
    expect(view.peer.answers).toBeNull();
  });

  it("active 에서도 열람 전 응답은 id·순번·비용·열람 여부뿐이다(유형·본문·길이 없음)", async () => {
    const { a, b } = await trio();
    await addItems(a, 4, "A의 비밀");
    const pair = await activePair(a, b);
    const blind = await peer(b, pair);
    expect(blind.items).toHaveLength(4);
    for (const i of blind.items) expect(Object.keys(i).sort()).toEqual(["cost", "id", "ordinal", "unlocked"]);
    const raw = JSON.stringify(blind);
    expect(raw).not.toMatch(/A의 비밀|"tell"|"ask"|"body"|"kind"/);
    expect(blind.opened).toEqual([]);
  });

  it("제3자와 다른 방 참가자는 목록을 볼 수 없다", async () => {
    const { a, b, c } = await trio();
    await addItems(a, 2, "A");
    const pair = await activePair(a, b);
    const other = await newRoom("타방");
    expect(await fails("dd_api_peer_items", c.room, c.t, pair)).toBe("NOT_FOUND");
    expect(await fails("dd_api_peer_items", other.room, other.t, pair)).toBe("NOT_FOUND");
    expect(await fails("dd_api_peer_items", a.room, other.t, pair)).toBe("UNAUTHENTICATED");
  });
});

describe("열람(결제)", () => {
  it("열람하면 열람자에게서 차감되어 소유자에게 이전되고, 방 합계는 보존된다", async () => {
    const { a, b } = await trio();
    const ids = await addItems(a, 3, "A의 비밀");
    const pair = await activePair(a, b);
    const total = await roomTotal(a.room);
    const blind = await peer(b, pair);
    const cost = blind.items.find((i) => i.id === ids[1])!.cost;
    const r = await unlock(b, pair, ids[1], cost);
    expect(r).toMatchObject({ already_unlocked: false, body: "A의 비밀 항목 1", kind: "ask", balance: 10 - cost });
    expect(await balance(a.id)).toBe(10 + cost);
    expect(await roomTotal(a.room)).toBe(total);
    expect(await ledgerMismatches()).toBe(0);
    const tx = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where unlock_id = $1 and type = 'unlock_payment'`, [r.unlock_id]);
    expect(tx[0].n).toBe(1);
  });

  it("비용 불일치는 거절되고, 같은 항목을 다시 열어도(새로고침·재시도) 추가 차감이 없다", async () => {
    const { a, b } = await trio();
    const ids = await addItems(a, 1, "A");
    const pair = await activePair(a, b);
    const cost = (await peer(b, pair)).items[0].cost;
    expect(await fails("dd_api_unlock_item", b.room, b.t, pair, ids[0], 99)).toBe("PRICE_CHANGED");
    expect(await balance(b.id)).toBe(10);
    const first = await unlock(b, pair, ids[0], cost);
    const second = await unlock(b, pair, ids[0], cost);
    expect(second).toMatchObject({ already_unlocked: true, unlock_id: first.unlock_id, body: first.body });
    expect(await balance(b.id)).toBe(10 - cost);
    const n = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where type = 'unlock_payment' and sender_id = $1`, [b.id]);
    expect(n[0].n).toBe(1);
  });

  it("자기 항목·제3자·없는 항목·잘못된 독대는 거절된다", async () => {
    const { a, b, c } = await trio();
    const aIds = await addItems(a, 2, "A");
    const bIds = await addItems(b, 1, "B");
    const pair = await activePair(a, b);
    expect(await fails("dd_api_unlock_item", a.room, a.t, pair, aIds[0], 1)).toBe("NOT_FOUND"); // 소유자 본인
    expect(await fails("dd_api_unlock_item", b.room, b.t, pair, bIds[0], 1)).toBe("NOT_FOUND"); // 열람자 본인 항목
    expect(await fails("dd_api_unlock_item", c.room, c.t, pair, aIds[0], 1)).toBe("NOT_FOUND"); // 제3자
    expect(await fails("dd_api_unlock_item", b.room, b.t, pair, "00000000-0000-4000-8000-000000000000", 1)).toBe("NOT_FOUND");
    expect(await fails("dd_api_unlock_item", b.room, b.t, "00000000-0000-4000-8000-000000000000", aIds[0], 1)).toBe("NOT_FOUND");
    expect(await balance(b.id)).toBe(10);
  });

  it("서로 반대 방향으로 열람해도 원장이 일치한다", async () => {
    const { a, b } = await trio();
    const aIds = await addItems(a, 2, "A의 비밀");
    const bIds = await addItems(b, 2, "B의 비밀");
    const pair = await activePair(a, b);
    const total = await roomTotal(a.room);
    const bView = await peer(b, pair);
    const aView = await peer(a, pair);
    expect(JSON.stringify(aView)).not.toContain("B의 비밀");
    const r1 = await unlock(b, pair, aIds[0], bView.items.find((i) => i.id === aIds[0])!.cost);
    const r2 = await unlock(a, pair, bIds[0], aView.items.find((i) => i.id === bIds[0])!.cost);
    expect(r1.body).toBe("A의 비밀 항목 0");
    expect(r2.body).toBe("B의 비밀 항목 0");
    expect(await roomTotal(a.room)).toBe(total);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("잔액이 부족하면 거절되고 잔액은 음수가 되지 않는다", async () => {
    const { a, b } = await trio();
    for (let i = 0; i < 5; i++) await api("dd_api_add_item", a.room, a.t, "tell", "제목", `A ${i}`, 3);
    const pair = await activePair(a, b);
    const items = (await peer(b, pair)).items;
    for (let i = 0; i < 3; i++) await unlock(b, pair, items[i].id, 3); // 9개 사용, 1개 남음
    expect(await balance(b.id)).toBe(1);
    expect(await fails("dd_api_unlock_item", b.room, b.t, pair, items[3].id, 3)).toBe("INSUFFICIENT_BALANCE");
    expect(await balance(b.id)).toBe(1);
    expect(await balance(a.id)).toBe(19);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("새 독대에서는 이전 열람이 재사용되지 않고 다시 지불해야 한다", async () => {
    const { a, b } = await trio();
    const ids = await addItems(a, 1, "A");
    const pair1 = await activePair(a, b);
    const cost = (await peer(b, pair1)).items[0].cost;
    await unlock(b, pair1, ids[0], cost);
    await api("dd_api_end_pair", a.room, a.t, pair1);
    const pair2 = await activePair(a, b);
    const again = await peer(b, pair2);
    expect(again.items.every((i) => !i.unlocked)).toBe(true);
    expect(again.opened).toEqual([]);
    const r = await unlock(b, pair2, ids[0], cost);
    expect(r.already_unlocked).toBe(false);
    expect(await balance(b.id)).toBe(10 - 2 * cost);
  });
});

describe("열람된 항목의 수정·삭제와 내용 보존(스냅샷)", () => {
  async function openedScenario() {
    const { a, b, c } = await trio();
    const ids = await addItems(a, 3, "A의 비밀");
    const pair = await activePair(a, b);
    const cost = (await peer(b, pair)).items.find((i) => i.id === ids[0])!.cost;
    const u = await unlock(b, pair, ids[0], cost);
    return { a, b, c, ids, pair, cost, u };
  }

  it("열람된 항목은 유형·본문을 바꿀 수 없고(비용만 변경 가능), 열람 전 항목은 수정할 수 있다", async () => {
    const { a, ids } = await openedScenario();
    expect(await fails("dd_api_update_item", a.room, a.t, ids[0], "tell", "A의 비밀 제목 0", "내용 바꾸기", 1)).toBe("ITEM_LOCKED");
    expect(await fails("dd_api_update_item", a.room, a.t, ids[0], "ask", "A의 비밀 제목 0", "A의 비밀 항목 0", 1)).toBe("ITEM_LOCKED");
    await api("dd_api_update_item", a.room, a.t, ids[0], "tell", "A의 비밀 제목 0", "A의 비밀 항목 0", 3); // 비용만
    await api("dd_api_update_item", a.room, a.t, ids[2], "ask", "새 제목", "열람 전에는 수정 가능", 2);
  });

  it("항목을 삭제해도 열람자는 독대가 끝나기 전까지 열람 당시 내용을 보고, 열람·거래 기록은 남는다", async () => {
    const { a, b, ids, pair, u } = await openedScenario();
    await api("dd_api_delete_item", a.room, a.t, ids[0]);
    const view = await peer(b, pair);
    expect(view.items.some((i) => i.id === ids[0])).toBe(false); // 블라인드 목록에서는 사라짐
    const opened = view.opened.find((o) => o.unlock_id === u.unlock_id)!;
    expect(opened).toMatchObject({ item_deleted: true, body: "A의 비밀 항목 0", kind: "tell" });
    const rec = await sql<{ item_id: string | null; tokens_paid: number }>(`select item_id, tokens_paid from dd_unlocks where id = $1`, [u.unlock_id]);
    expect(rec[0].item_id).toBeNull();
    expect(rec[0].tokens_paid).toBeGreaterThan(0);
    const tx = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where unlock_id = $1`, [u.unlock_id]);
    expect(tx[0].n).toBe(1);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("삭제된 항목의 내용은 제3자·다른 방 참가자·소유자의 상대 목록으로 새어 나가지 않는다", async () => {
    const { a, b, c, ids, pair } = await openedScenario();
    await api("dd_api_delete_item", a.room, a.t, ids[0]);
    expect(await fails("dd_api_peer_items", c.room, c.t, pair)).toBe("NOT_FOUND");
    const other = await newRoom("타방");
    expect(await fails("dd_api_peer_items", other.room, other.t, pair)).toBe("NOT_FOUND");
    expect(JSON.stringify(await peer(a, pair))).not.toContain("A의 비밀 항목 0"); // 본인 열람건만 스냅샷을 받는다
    expect(JSON.stringify(await api("dd_api_my_items", a.room, a.t))).not.toContain("A의 비밀 항목 0");
    expect(JSON.stringify(await api("dd_api_overview", c.room, c.t))).not.toContain("A의 비밀");
    expect(b.id).not.toBe(c.id);
  });

  it("독대가 끝나면 스냅샷 내용이 DB 에서 삭제되고 열람 기록은 남는다", async () => {
    const { a, b, pair, u } = await openedScenario();
    await api("dd_api_end_pair", a.room, a.t, pair);
    const closed = await peer(b, pair);
    expect(closed.items).toEqual([]);
    expect(closed.opened[0]).toMatchObject({ body: null, kind: null });
    expect(JSON.stringify(closed)).not.toContain("A의 비밀");
    const rows = await sql<{ snapshot_body: string | null; snapshot_kind: string | null }>(`select snapshot_body, snapshot_kind from dd_unlocks where id = $1`, [u.unlock_id]);
    expect(rows[0]).toEqual({ snapshot_body: null, snapshot_kind: null });
    expect(await fails("dd_api_unlock_item", b.room, b.t, pair, "00000000-0000-4000-8000-000000000000", 1)).toBe("INVALID_STATE");
  });
});

describe("소유자의 열람 현황", () => {
  it("누가 언제 열었고 보상이 확정됐는지만 보이며, 미확정 선택값과 다른 정보는 보이지 않는다", async () => {
    const { a, b } = await trio();
    const ids = await addItems(a, 2, "A");
    const pair = await activePair(a, b);
    const cost = (await peer(b, pair)).items.find((i) => i.id === ids[1])!.cost;
    const u = await unlock(b, pair, ids[1], cost);
    await api("dd_api_set_reward", b.room, b.t, u.unlock_id, 3);

    const mine = await api<{ items: { id: string; opens: Record<string, unknown>[] }[] }>("dd_api_my_items", a.room, a.t);
    const opens = mine.items.find((i) => i.id === ids[1])!.opens;
    expect(opens).toHaveLength(1);
    expect(Object.keys(opens[0]).sort()).toEqual(["opened_at", "reward_amount", "reward_confirmed", "tokens_paid", "unlock_id", "viewer_nickname"]);
    expect(opens[0]).toMatchObject({ viewer_nickname: "비", reward_confirmed: false, reward_amount: null, tokens_paid: cost });
    expect(mine.items.find((i) => i.id === ids[0])!.opens).toEqual([]);

    await api("dd_api_confirm_reward", b.room, b.t, u.unlock_id, 3);
    const after = await api<{ items: { id: string; opens: Record<string, unknown>[] }[] }>("dd_api_my_items", a.room, a.t);
    expect(after.items.find((i) => i.id === ids[1])!.opens[0]).toMatchObject({ reward_confirmed: true, reward_amount: 3 });
  });
});

describe("보상: 선택과 확정의 분리", () => {
  async function opened() {
    const { a, b, c } = await trio();
    const ids = await addItems(a, 2, "A");
    const pair = await activePair(a, b);
    const items = (await peer(b, pair)).items;
    const u = await unlock(b, pair, ids[0], items.find((i) => i.id === ids[0])!.cost);
    return { a, b, c, ids, pair, u, cost: u.balance === undefined ? 0 : 10 - u.balance };
  }

  it("선택(set_reward)은 잔액·거래를 바꾸지 않고, 범위(0~5)와 대상(본인 열람건)을 검증한다", async () => {
    const { a, b, c, u } = await opened();
    const before = [await balance(a.id), await balance(b.id)];
    expect(await fails("dd_api_set_reward", b.room, b.t, u.unlock_id, 6)).toBe("VALIDATION");
    expect(await fails("dd_api_set_reward", b.room, b.t, u.unlock_id, -1)).toBe("VALIDATION");
    expect(await fails("dd_api_set_reward", a.room, a.t, u.unlock_id, 1)).toBe("NOT_FOUND"); // 소유자
    expect(await fails("dd_api_set_reward", c.room, c.t, u.unlock_id, 1)).toBe("NOT_FOUND"); // 제3자
    await api("dd_api_set_reward", b.room, b.t, u.unlock_id, 3);
    await api("dd_api_set_reward", b.room, b.t, u.unlock_id, 2); // 확정 전에는 바꿀 수 있다
    expect([await balance(a.id), await balance(b.id)]).toEqual(before);
    const n = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where type = 'reward' and room_id = $1`, [a.room]);
    expect(n[0].n).toBe(0);
  });

  it("확정은 선택 이후, 선택값과 같을 때만 가능하고 열람 건당 한 번만 이전된다", async () => {
    const { a, b, c, u } = await opened();
    expect(await fails("dd_api_confirm_reward", b.room, b.t, u.unlock_id, 2)).toBe("REWARD_NOT_SELECTED");
    await api("dd_api_set_reward", b.room, b.t, u.unlock_id, 2);
    expect(await fails("dd_api_confirm_reward", b.room, b.t, u.unlock_id, 3)).toBe("REWARD_CHANGED");
    expect(await fails("dd_api_confirm_reward", a.room, a.t, u.unlock_id, 2)).toBe("NOT_FOUND");
    expect(await fails("dd_api_confirm_reward", c.room, c.t, u.unlock_id, 2)).toBe("NOT_FOUND");

    const total = await roomTotal(a.room);
    const before = [await balance(a.id), await balance(b.id)];
    const r1 = await api<{ duplicate: boolean }>("dd_api_confirm_reward", b.room, b.t, u.unlock_id, 2);
    const r2 = await api<{ duplicate: boolean }>("dd_api_confirm_reward", b.room, b.t, u.unlock_id, 2);
    expect([r1.duplicate, r2.duplicate]).toEqual([false, true]);
    expect([await balance(a.id), await balance(b.id)]).toEqual([before[0] + 2, before[1] - 2]);
    expect(await roomTotal(a.room)).toBe(total); // 보상 전후 방 합계 보존
    const n = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where type = 'reward' and unlock_id = $1`, [u.unlock_id]);
    expect(n[0].n).toBe(1);
    expect(await fails("dd_api_set_reward", b.room, b.t, u.unlock_id, 1)).toBe("REWARD_DONE");
    expect(await ledgerMismatches()).toBe(0);
  });

  it("0개도 유효한 확정이며 이때는 거래가 생기지 않는다", async () => {
    const { a, b, u } = await opened();
    const before = [await balance(a.id), await balance(b.id)];
    await api("dd_api_set_reward", b.room, b.t, u.unlock_id, 0);
    const z = await api<{ reward_amount: number; duplicate: boolean }>("dd_api_confirm_reward", b.room, b.t, u.unlock_id, 0);
    expect(z).toMatchObject({ reward_amount: 0, duplicate: false });
    expect([await balance(a.id), await balance(b.id)]).toEqual(before);
    const n = await sql<{ n: number }>(`select count(*)::int n from dd_token_tx where type = 'reward' and room_id = $1`, [a.room]);
    expect(n[0].n).toBe(0);
    expect(await fails("dd_api_set_reward", b.room, b.t, u.unlock_id, 3)).toBe("REWARD_DONE");
  });

  it("독대가 종료된 뒤에도 이미 열람한 항목의 보상은 확정할 수 있다", async () => {
    const { a, b, pair, u } = await (async () => {
      const o = await opened();
      return o;
    })();
    await api("dd_api_set_reward", b.room, b.t, u.unlock_id, 2);
    await api("dd_api_end_pair", a.room, a.t, pair);
    const total = await roomTotal(a.room);
    const r = await api<{ duplicate: boolean; reward_amount: number }>("dd_api_confirm_reward", b.room, b.t, u.unlock_id, 2);
    expect(r).toMatchObject({ duplicate: false, reward_amount: 2 });
    expect(await roomTotal(a.room)).toBe(total);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("보상 확정 시 잔액이 부족하면 거절되고 아무것도 바뀌지 않는다", async () => {
    const { a, b } = await trio();
    for (let i = 0; i < 4; i++) await api("dd_api_add_item", a.room, a.t, "tell", "제목", `A ${i}`, 3);
    const pair = await activePair(a, b);
    const items = (await peer(b, pair)).items;
    const unlocks = [];
    for (let i = 0; i < 3; i++) unlocks.push(await unlock(b, pair, items[i].id, 3)); // 9개 사용, 1개 남음
    await api("dd_api_set_reward", b.room, b.t, unlocks[0].unlock_id, 5);
    expect(await fails("dd_api_confirm_reward", b.room, b.t, unlocks[0].unlock_id, 5)).toBe("INSUFFICIENT_BALANCE");
    expect(await balance(b.id)).toBe(1);
    const row = await sql<{ reward_confirmed_at: string | null }>(`select reward_confirmed_at from dd_unlocks where id = $1`, [unlocks[0].unlock_id]);
    expect(row[0].reward_confirmed_at).toBeNull(); // 확정되지 않았으므로 다시 시도할 수 있다
    expect(await ledgerMismatches()).toBe(0);
  });
});

describe("원장 불변식과 권한", () => {
  it("전체 토큰 총량은 초기 지급 합과 같고 음수 잔액이 없다", async () => {
    const sums = (await sql<{ w: number; g: number }>(`select (select sum(balance) from dd_wallets)::int w, (select sum(amount) from dd_token_tx where type = 'initial_grant')::int g`))[0];
    expect(sums.w).toBe(sums.g);
    const neg = await sql<{ n: number }>(`select count(*)::int n from dd_wallets where balance < 0`);
    expect(neg[0].n).toBe(0);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("anon/authenticated 에 열린 것은 dd_api_* 함수뿐이고, 토큰 테이블은 RLS 활성 + 직접 접근 불가다", async () => {
    const fn = await sql<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and left(p.proname, 3) = 'dd_' and left(p.proname, 7) <> 'dd_api_'
         and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
    );
    expect(fn).toEqual([]);
    for (const t of ["dd_wallets", "dd_items", "dd_unlocks", "dd_token_tx"]) {
      expect((await errorOf(db.as(ANON, `select * from public.${t}`))).message).toMatch(/permission denied/);
      expect((await errorOf(db.as({ role: "authenticated" }, `delete from public.${t}`))).message).toMatch(/permission denied/);
    }
    const rls = await sql<{ relname: string }>(`select relname from pg_class where relname in ('dd_wallets','dd_items','dd_unlocks','dd_token_tx') and not relrowsecurity`);
    expect(rls).toEqual([]);
  });

  it("DB 제약: 음수 잔액·잘못된 거래·active 없이 동의 등은 직접 조작해도 거절된다", async () => {
    const a = await newRoom();
    expect((await errorOf(sql(`update dd_wallets set balance = -1 where participant_id = $1`, [a.id]))).message).toMatch(/check constraint/);
    expect((await errorOf(sql(`insert into dd_token_tx (room_id, recipient_id, amount, type) values ($1, $2, 0, 'initial_grant')`, [a.room, a.id]))).message).toMatch(/check constraint/);
    expect((await errorOf(sql(`insert into dd_token_tx (room_id, recipient_id, amount, type) values ($1, $2, 5, 'initial_grant')`, [a.room, a.id]))).message).toMatch(/duplicate key|unique/);
  });
});

describe("기본 항목(기본 질문 슬롯)과 제목", () => {
  const defaultQuestions = () => api<{ id: string; title: string; body: string }[]>("dd_api_default_questions");

  it("슬롯은 항상 5개 보이고 내용을 쓴 것만 항목 행이 되며, 상대에게는 쓴 것만 개수로 잡힌다", async () => {
    const { a, b } = await trio();
    const qs = await defaultQuestions();
    const mine = await api<{ defaults: { question_id: string; title: string; prompt: string; item: unknown }[]; custom_limit: number }>("dd_api_my_items", a.room, a.t);
    expect(mine.defaults).toHaveLength(5);
    expect(mine.defaults.every((d) => d.item === null)).toBe(true);
    expect(mine.custom_limit).toBe(5);
    await api("dd_api_save_default_item", a.room, a.t, qs[1].id, "두 번째 기본 항목 내용", 2);
    await addItems(a, 1, "A");
    const pair = await activePair(a, b);
    const blind = await peer(b, pair);
    expect(blind.items).toHaveLength(2); // 쓰지 않은 기본 항목은 상대에게 보이지 않는다
    expect(JSON.stringify(blind)).not.toMatch(/두 번째 기본 항목|지금의 나|알아줬으면|"title"|"prompt"/);
    const after = await api<{ defaults: { item: { body: string; cost: number } | null }[] }>("dd_api_my_items", a.room, a.t);
    expect(after.defaults.filter((d) => d.item).length).toBe(1);
    // 비우기: 슬롯은 남고 항목만 사라진다
    const slot = after.defaults.find((d) => d.item) as unknown as { item: { id: string } };
    await api("dd_api_delete_item", a.room, a.t, slot.item.id);
    const cleared = await api<{ defaults: unknown[] }>("dd_api_my_items", a.room, a.t);
    expect(cleared.defaults).toHaveLength(5);
  });

  it("기본 항목 검증: 범위 밖 비용·빈 내용·없는 질문·직접 추가 항목의 질문 ID 위조는 거절된다", async () => {
    const { a, b } = await trio();
    const qs = await defaultQuestions();
    expect(await fails("dd_api_save_default_item", a.room, a.t, qs[0].id, "내용", 4)).toBe("VALIDATION");
    expect(await fails("dd_api_save_default_item", a.room, a.t, qs[0].id, "  ", 1)).toBe("VALIDATION");
    expect(await fails("dd_api_save_default_item", a.room, a.t, "00000000-0000-4000-8000-0000000000ff", "내용", 1)).toBe("NOT_FOUND");
    expect(await fails("dd_api_save_default_item", a.room, "wrong", qs[0].id, "내용", 1)).toBe("UNAUTHENTICATED");
    const personal = await addItems(b, 1, "B");
    expect(await fails("dd_api_update_item", b.room, b.t, personal[0], "tell", "", "내용", 1)).toBe("VALIDATION"); // 직접 추가 항목은 제목 필수
    // 기본 항목은 update_item 으로 바꿀 수 없다(save_default_item 전용)
    const id = await api<string>("dd_api_save_default_item", a.room, a.t, qs[0].id, "내용", 1);
    expect(await fails("dd_api_update_item", a.room, a.t, id, "tell", "제목", "변조", 1)).toBe("NOT_FOUND");
  });

  it("열람하면 제목·질문 문구·내용이 스냅샷으로 보이고, 이후 편집과 종료에 맞춰 보존·삭제된다", async () => {
    const { a, b, c } = await trio();
    const qs = await defaultQuestions();
    const defId = await api<string>("dd_api_save_default_item", a.room, a.t, qs[0].id, "기본 항목 내용", 1);
    const [custom] = await addItems(a, 1, "A의 비밀");
    const pair = await activePair(a, b);
    const blind = await peer(b, pair);
    const costDef = blind.items.find((i) => i.id === defId)!.cost;
    const r = await unlock(b, pair, defId, costDef);
    expect(r).toMatchObject({ kind: "tell", title: qs[0].title, prompt: qs[0].body, body: "기본 항목 내용" });
    const costCustom = blind.items.find((i) => i.id === custom)!.cost;
    const rc = await unlock(b, pair, custom, costCustom);
    expect(rc).toMatchObject({ title: "A의 비밀 제목 0", prompt: null, body: "A의 비밀 항목 0" });

    // 열람 후에는 내용 수정 금지(비용만 가능), 비우기·삭제 후에도 열람자는 스냅샷을 본다
    expect(await fails("dd_api_save_default_item", a.room, a.t, qs[0].id, "내용 바꾸기", 1)).toBe("ITEM_LOCKED");
    await api("dd_api_save_default_item", a.room, a.t, qs[0].id, "기본 항목 내용", 3);
    await sql(`update dd_questions set title = '관리자가 바꾼 제목' where id = $1`, [qs[0].id]);
    await api("dd_api_delete_item", a.room, a.t, defId);
    await api("dd_api_delete_item", a.room, a.t, custom);
    const view = await peer(b, pair);
    const opened = view.opened as { title: string; prompt: string | null; body: string; item_deleted: boolean }[];
    expect(opened.map((o) => o.title).sort()).toEqual([qs[0].title, "A의 비밀 제목 0"].sort()); // 열람 당시 제목
    expect(opened.every((o) => o.item_deleted)).toBe(true);
    await sql(`update dd_questions set title = $2 where id = $1`, [qs[0].id, qs[0].title]);

    // 제3자에게는 제목·질문·내용이 어느 경로로도 보이지 않는다
    expect(await fails("dd_api_peer_items", c.room, c.t, pair)).toBe("NOT_FOUND");
    expect(JSON.stringify(await api("dd_api_my_items", c.room, c.t))).not.toMatch(/기본 항목 내용|A의 비밀/);

    // 종료하면 스냅샷의 제목·질문 문구·내용이 모두 DB에서 지워진다
    await api("dd_api_end_pair", a.room, a.t, pair);
    const closed = await sql<{ n: number }>(
      `select count(*)::int n from dd_unlocks where pair_id = $1 and (snapshot_title is not null or snapshot_prompt is not null or snapshot_body is not null or snapshot_kind is not null)`,
      [pair],
    );
    expect(closed[0].n).toBe(0);
    const afterClose = await peer(b, pair);
    expect(JSON.stringify(afterClose)).not.toMatch(/기본 항목 내용|A의 비밀|"title":"/);
    expect(await ledgerMismatches()).toBe(0);
  });
});
