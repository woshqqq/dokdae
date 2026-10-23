import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Supabase 마이그레이션을 PGlite(인프로세스 PostgreSQL)에 적용해 RLS·GRANT·RPC를 검증하는 테스트 하네스.
//
// Supabase가 제공하는 것 중 마이그레이션이 의존하는 부분만 재현한다:
//  - anon / authenticated / service_role 역할
//  - auth 스키마, auth.users, auth.uid() (request.jwt.claim.sub 설정값을 읽음)
//  - public 스키마 객체에 대한 기본 권한(anon·authenticated에 ALL) — 마이그레이션의 REVOKE가 실제로 효과가 있는지 확인하기 위함
//
// 한계: 단일 연결이므로 진짜 동시 트랜잭션(행 잠금 경쟁)은 재현할 수 없다.

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export interface DbError extends Error {
  code?: string;
  detail?: string;
}

export type Role = "anon" | "authenticated" | "service_role";

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  static async create() {
    const pg = new PGlite();
    await pg.exec(SUPABASE_STUB);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    return new TestDb(pg);
  }

  /** 관리자(postgres)로 실행. RLS를 우회한다 — 검증용 조회와 테스트 데이터 조작에만 사용. */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  /** 관리자로 여러 SQL 문을 한 번에 실행(테스트용 트리거 설치 등). */
  async adminExec(sql: string) {
    await this.pg.exec(sql);
  }

  /** 지정한 역할(과 로그인 사용자)로 실행. 브라우저에서 PostgREST로 들어오는 요청에 해당한다. */
  async as<T = Record<string, unknown>>(
    who: { role: Role; uid?: string | null },
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await this.pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who.uid ?? ""]);
    await this.pg.exec(`set role ${who.role}`);
    try {
      return (await this.pg.query<T>(sql, params)).rows;
    } finally {
      await this.pg.exec("reset role");
      await this.pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
    }
  }

  /** 로그인 사용자로 RPC 호출. jsonb 결과를 그대로 돌려준다. */
  async rpc<T = unknown>(uid: string | null, fn: string, args: unknown[] = []): Promise<T> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await this.as<{ result: T }>({ role: "authenticated", uid }, `select public.${fn}(${placeholders}) as result`, args);
    return rows[0]?.result as T;
  }

  async createUser(displayName: string) {
    const id = randomUUID();
    await this.admin(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      `${id.slice(0, 8)}@example.test`,
      JSON.stringify({ display_name: displayName }),
    ]);
    return id;
  }

  async close() {
    await this.pg.close();
  }
}

/** 프로미스가 지정한 오류 코드(예외 message)로 실패하는지 확인할 때 쓰는 헬퍼 */
export async function errorOf(promise: Promise<unknown>): Promise<DbError> {
  try {
    await promise;
  } catch (e) {
    return e as DbError;
  }
  throw new Error("expected the database call to fail");
}
