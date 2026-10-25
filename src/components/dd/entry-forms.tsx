"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createRoomAction, joinRoomAction } from "@/app/actions/dd";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function CreateRoomForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await createRoomAction({ name, nickname });
          if (!result.ok) return setError(result.error);
          router.push(`/room/${result.data.roomId}?created=1`);
        });
      }}
    >
      <Field label="방 이름" htmlFor="room-name">
        <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      </Field>
      <Field label="내 닉네임" htmlFor="create-nickname">
        <Input id="create-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={20} />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" pending={pending}>
        방 만들기
      </Button>
    </form>
  );
}

export function JoinRoomForm() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [nickname, setNickname] = useState("");
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
          router.push(`/room/${result.data.roomId}`);
        });
      }}
    >
      <Field label="초대 코드" htmlFor="invite-code" hint="방을 만든 사람에게 받은 코드예요. 예: ABCD-EFGH">
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
      <Field label="내 닉네임" htmlFor="join-nickname">
        <Input id="join-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={20} />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" pending={pending}>
        입장하기
      </Button>
    </form>
  );
}
