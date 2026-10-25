import { LinkButton } from "@/components/ui/button";

/** 이 기기에 해당 방의 참가자 증표가 없을 때 보여준다. 방의 존재 여부나 내용은 알려주지 않는다. */
export function NoAccess() {
  return (
    <div className="space-y-4 py-10 text-center">
      <p className="text-4xl" aria-hidden>
        🔒
      </p>
      <h1 className="text-xl font-bold">이 방에 입장한 기록이 없어요</h1>
      <p className="text-muted">초대 코드로 입장한 기기에서만 볼 수 있습니다.</p>
      <LinkButton href="/" variant="secondary">
        초대 코드로 입장하기
      </LinkButton>
    </div>
  );
}
