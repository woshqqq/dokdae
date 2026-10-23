"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { joinRoomAction } from "@/app/actions/rooms";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function JoinRoomForm({ defaultNickname }: { defaultNickname: string }) {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [nickname, setNickname] = useState(defaultNickname);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await joinRoomAction({ inviteCode, nickname });
          if (!result.ok) return setError(result.error);
          router.push(`/rooms/${result.data.roomId}${result.data.alreadyMember ? "?rejoined=1" : "?joined=1"}`);
        });
      }}
    >
      <Field label="모임 코드" htmlFor="invite-code" hint="운영자에게 받은 코드를 입력하세요. 예: ABCD-1234">
        <Input
          id="invite-code"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono tracking-wider"
          required
          maxLength={20}
        />
      </Field>
      <Field label="이 모임에서 쓸 닉네임" htmlFor="join-nickname">
        <Input id="join-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={20} />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" pending={pending}>
        입장하기
      </Button>
    </form>
  );
}
