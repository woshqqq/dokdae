import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-xl font-bold">페이지를 찾을 수 없어요</h1>
      <p className="text-muted">주소가 바뀌었거나 삭제된 페이지입니다.</p>
      <LinkButton href="/" variant="secondary">
        처음으로
      </LinkButton>
    </div>
  );
}
