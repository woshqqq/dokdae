import { notFound } from "next/navigation";
import { Suspense } from "react";
import { endTestSession } from "@/app/actions/test-mode";
import { PageHeader, PageSkeleton } from "@/components/page";
import { TestLoginForm } from "@/components/test-mode/test-login-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getAuthContext } from "@/lib/auth/session";
import { isTestModeEnabled } from "@/lib/test-mode/config";

export const metadata = { title: "테스트 모드", robots: { index: false } };

export default function TestLoginPage({ searchParams }: PageProps<"/test-login">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TestLogin searchParams={searchParams} />
    </Suspense>
  );
}

async function TestLogin({ searchParams }: Pick<PageProps<"/test-login">, "searchParams">) {
  // 쿠키를 먼저 읽어 요청 시점에 판단한다(환경변수를 바꾼 뒤 다시 배포하면 바로 반영).
  const context = await getAuthContext();
  if (!isTestModeEnabled()) notFound();
  const params = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader title="비회원 테스트 모드" subtitle="회원가입·이메일 인증 없이 데모 데이터로 독대 흐름을 확인합니다." />
      {params.expired ? <Notice tone="warn">테스트 세션이 만료되었습니다. 다시 시작해 주세요.</Notice> : null}
      {params.ended ? <Notice tone="success">테스트 세션을 종료했습니다.</Notice> : null}
      <Notice tone="info" title="알아 두세요">
        <ul className="list-disc space-y-1 pl-4">
          <li>실제 회원 데이터나 운영 DB를 읽거나 바꾸지 않습니다. 모든 데이터는 테스트 공간 안의 임시 데이터입니다.</li>
          <li>데이터는 서버 메모리에만 있어 서버가 바뀌거나 재시작되면 언제든 초기화될 수 있습니다.</li>
          <li>세션은 8시간 뒤 만료됩니다.</li>
        </ul>
      </Notice>
      {context.kind === "test" ? (
        <div className="space-y-3">
          <Notice tone="success">이미 테스트 세션이 진행 중입니다.</Notice>
          <LinkButton href="/" size="lg">
            테스트 계속하기
          </LinkButton>
          <form action={endTestSession}>
            <Button type="submit" variant="secondary" size="lg">
              테스트 종료
            </Button>
          </form>
        </div>
      ) : (
        <TestLoginForm />
      )}
    </div>
  );
}
