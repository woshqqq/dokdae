import { endTestSession } from "@/app/actions/test-mode";
import { getAuthContext } from "@/lib/auth/session";
import { isSandboxRestored } from "@/lib/data/mock/sandboxes";
import { formatTime } from "@/lib/format";

/** 임시 데이터·테스트 모드에서는 모든 화면에 항상 표시한다. 실제 기능처럼 보이지 않게 하기 위함. */
export async function MockBanner() {
  const context = await getAuthContext();
  if (context.kind === "test") return <TestModeBanner sid={context.session.sid} exp={context.session.exp} />;
  if (context.kind !== "mock") return null;
  return (
    <div role="note" className="bg-ink px-4 py-2 text-center text-xs leading-relaxed text-white">
      <strong className="font-bold">임시 데이터 모드</strong> · 실제 로그인·DB 저장·정산이 아닙니다. 서버를 재시작하면
      초기화됩니다.
    </div>
  );
}

function TestModeBanner({ sid, exp }: { sid: string; exp: number }) {
  const restored = isSandboxRestored(sid);
  return (
    <div role="note" className="bg-ink px-4 py-2 text-xs leading-relaxed text-white">
      <div className="mx-auto flex max-w-lg flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p>
          <strong className="font-bold">비회원 테스트 모드</strong> · 임시 데이터이며 언제든 초기화될 수 있어요 ·{" "}
          {formatTime(new Date(exp).toISOString())}까지
        </p>
        <form action={endTestSession}>
          <button type="submit" className="min-h-8 rounded-md bg-white/15 px-2.5 font-semibold hover:bg-white/25">
            테스트 종료
          </button>
        </form>
      </div>
      {restored ? (
        <p className="mx-auto mt-1 max-w-lg text-warn-soft">
          이 서버 인스턴스에 이전 테스트 데이터가 없어 공간을 새로 만들었습니다. 만든 모임·독대가 보이지 않을 수 있어요.
        </p>
      ) : null}
      <details className="mx-auto mt-1 max-w-lg">
        <summary className="cursor-pointer text-white/80">함께 테스트하기 (공간 코드)</summary>
        <p className="mt-1">
          다른 브라우저에서 <code>/test-login</code>에 이 코드를 넣으면 같은 공간에 들어올 수 있어요:{" "}
          <code className="select-all break-all font-mono">{sid}</code>
        </p>
      </details>
    </div>
  );
}
