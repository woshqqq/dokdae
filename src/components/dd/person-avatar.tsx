import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";

const sizes = { sm: "size-8", md: "size-10", lg: "size-20" } as const;

/** 사진이 있으면 권한 확인 라우트에서 받아 보여주고, 없으면 기본 아바타를 보여준다. */
export function PersonAvatar({
  roomId,
  id,
  nickname,
  hasPhoto,
  size = "md",
}: {
  roomId: string;
  id: string;
  nickname: string;
  hasPhoto: boolean;
  size?: keyof typeof sizes;
}) {
  if (!hasPhoto) return <Avatar seed={id} name={nickname} size={size} />;
  return (
    // 인증이 필요한 라우트의 이미지라 next/image 최적화를 쓰지 않는다.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/room/${roomId}/photo/${id}`}
      alt={`${nickname} 프로필 사진`}
      width={80}
      height={80}
      className={cn("shrink-0 rounded-full bg-sunken object-cover", sizes[size])}
    />
  );
}
