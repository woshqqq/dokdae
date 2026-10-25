import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDbProof } from "../../src/lib/dd/admin-session";
import { TestDb } from "./harness";

// 적용 직전 검토용: 권한 목록 전체 점검, 관리자 등록 SQL 호환성, PostgREST 방식 bytea 전달 호환성.

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("권한 전체 점검", () => {
  it("dd_ 함수 중 anon/authenticated 가 실행할 수 있는 것은 dd_api_* 뿐이다", async () => {
    const rows = await db.admin<{ proname: string; role: string }>(
      `select p.proname, r.role
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(role)
       where n.nspname = 'public' and left(p.proname, 3) = 'dd_' and has_function_privilege(r.role, p.oid, 'EXECUTE')
         and left(p.proname, 7) <> 'dd_api_'`,
    );
    expect(rows).toEqual([]);
  });

  it("모든 dd_api_* 함수는 SECURITY DEFINER + search_path 고정이며, 참가자 함수는 토큰 검증(dd_resolve)을 거친다", async () => {
    const rows = await db.admin<{ proname: string; prosecdef: boolean; cfg: string | null; src: string }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg, p.prosrc as src
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and left(p.proname, 7) = 'dd_api_'`,
    );
    expect(rows.length).toBe(30);
    // 토큰 검증 없이 동작하는 것은 의도된 2개뿐: 기본 질문 조회(공개 문구), 관리자 수정(증명 해시 + DB 잠금). 방 생성·입장은 토큰을 새로 등록한다.
    const noResolve = rows.filter((r) => !/dd_resolve|dd_hash_text\(p_token\)/.test(r.src)).map((r) => r.proname).sort();
    expect(noResolve).toEqual(["dd_api_admin_update_question", "dd_api_default_questions"]);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.cfg, r.proname).toContain("search_path=");
    }
  });

  it("anon/authenticated 는 dd_ 테이블을 읽거나 쓸 수 없고 RLS가 모두 켜져 있다", async () => {
    const rows = await db.admin<{ relname: string; rls: boolean; anon: boolean; auth: boolean }>(
      `select c.relname, c.relrowsecurity as rls,
              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon,
              has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as auth
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and left(c.relname, 3) = 'dd_'`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(
      ["dd_admin_proof", "dd_answers", "dd_items", "dd_pairs", "dd_participants", "dd_photos", "dd_questions", "dd_rooms", "dd_settings", "dd_token_tx", "dd_unlocks", "dd_wallets"],
    );
    for (const r of rows) expect(r, r.relname).toMatchObject({ rls: true, anon: false, auth: false });
  });
});

describe("관리자 등록 절차", () => {
  it("npm run admin:proof 가 만드는 SQL 을 실행하면 앱이 보내는 증명값이 통과한다", async () => {
    const password = "review-password-123";
    const script = fileURLToPath(new URL("../../scripts/admin-proof.mjs", import.meta.url));
    const sql = execFileSync(process.execPath, [script], {
      env: { ...process.env, DOKDAE_ADMIN_PASSWORD: password },
      encoding: "utf8",
    });
    expect(sql).not.toContain(password); // 비밀번호는 출력되지 않는다
    await db.admin(sql); // SQL Editor 에서 실행하는 것과 같은 문장
    await db.admin(sql); // 다시 실행해도 안전(멱등)
    const ok = await db.as<{ r: string }>(
      { role: "anon" },
      `select public.dd_api_admin_update_question($1, '00000000-0000-4000-8000-0000000000a2', '제목', '본문', '', 2) as r`,
      [adminDbProof(password)],
    );
    expect(ok[0].r).toBe("ok");
    const denied = await db.as<{ r: string }>(
      { role: "anon" },
      `select public.dd_api_admin_update_question($1, '00000000-0000-4000-8000-0000000000a2', '제목', '본문', '', 2) as r`,
      [adminDbProof("another-password-1")],
    );
    expect(denied[0].r).toBe("denied");
  });

  it("비밀번호가 8자 미만이면 스크립트는 SQL 없이 실패한다", () => {
    const script = fileURLToPath(new URL("../../scripts/admin-proof.mjs", import.meta.url));
    let failed = false;
    try {
      execFileSync(process.execPath, [script], { env: { ...process.env, DOKDAE_ADMIN_PASSWORD: "short" }, stdio: "pipe" });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe("사진 전달 형식", () => {
  it("PostgREST 방식(JSON 본문의 \\x 16진수 문자열 → bytea)으로 저장·조회된다", async () => {
    // PostgREST 는 RPC JSON 본문을 json_to_record 로 인자 타입에 맞춰 변환한다.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 7)]);
    const body = JSON.stringify({ p_mime: "image/jpeg", p_data: "\\x" + jpeg.toString("hex") });
    const rows = await db.admin<{ p_data: Uint8Array }>(
      `select p_data from json_to_record($1::json) as t(p_mime text, p_data bytea)`,
      [body],
    );
    expect(Buffer.from(rows[0].p_data).equals(jpeg)).toBe(true);
    // 반환(base64)을 서버가 Buffer 로 복원하는 경로
    const b64 = (await db.admin<{ b: string }>(`select encode($1::bytea, 'base64') as b`, [new Uint8Array(jpeg)]))[0].b;
    expect(Buffer.from(b64, "base64").equals(jpeg)).toBe(true);
  });
});
