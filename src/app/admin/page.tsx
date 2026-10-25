import { connection } from "next/server";
import { Suspense } from "react";
import { AdminLoginForm, AdminLogoutButton, DefaultQuestionForm, type AdminQuestion } from "@/components/admin/admin-forms";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { isAdminAuthenticated, isAdminEnabled } from "@/lib/dd/admin";
import { ddRpc } from "@/lib/dd/db";

export const metadata = { title: "관리자" };

export default function AdminPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Admin />
    </Suspense>
  );
}

async function Admin() {
  // 환경변수는 빌드 시점이 아니라 요청 시점에 읽는다(정적 프리렌더에 "꺼짐" 상태가 굳지 않게 한다).
  await connection();
  // 비밀번호가 설정되어 있지 않으면 로그인 화면 자체를 열지 않는다.
  if (!isAdminEnabled()) {
    return (
      <Notice tone="warn" title="관리자 기능이 꺼져 있어요">
        서버 환경변수 DOKDAE_ADMIN_PASSWORD(8자 이상)를 설정하면 켜집니다.
      </Notice>
    );
  }
  if (!(await isAdminAuthenticated())) {
    return (
      <div className="space-y-6">
        <PageHeader title="관리자 로그인" />
        <Card>
          <AdminLoginForm />
        </Card>
      </div>
    );
  }

  // 질문 문구만 읽는다. 참가자 정보와 답변은 이 화면에서 조회하지 않는다.
  const data = await ddRpc<AdminQuestion[]>("dd_api_default_questions");

  return (
    <div className="space-y-6">
      <PageHeader title="기본 질문 관리" subtitle="모든 방에 공통으로 적용돼요. 질문 ID는 유지되어 이미 쓴 답변은 그대로 이어집니다." action={<AdminLogoutButton />} />
      <ul className="space-y-4">
        {data.map((q) => (
          <li key={q.id}>
            <DefaultQuestionForm q={q} />
          </li>
        ))}
      </ul>
    </div>
  );
}
