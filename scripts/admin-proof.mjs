// 관리자 기본 질문 수정을 켜기 위한 SQL을 출력한다(비밀번호는 출력하지 않는다).
// 사용: node --env-file=.env.local scripts/admin-proof.mjs  → 출력된 SQL을 Supabase SQL Editor에서 직접 실행
import { createHash, createHmac } from "node:crypto";

const password = process.env.DOKDAE_ADMIN_PASSWORD;
if (!password || password.length < 8) {
  console.error("DOKDAE_ADMIN_PASSWORD(8자 이상)가 설정되어 있지 않습니다.");
  process.exit(1);
}
const proof = createHmac("sha256", password).update("dokdae-admin-db-proof-v1").digest("hex");
const hash = createHash("sha256").update(proof).digest("hex");
console.log(`insert into public.dd_admin_proof (proof_hash) values ('${hash}')
on conflict (id) do update set proof_hash = excluded.proof_hash, fail_count = 0, fail_window_start = null;`);
