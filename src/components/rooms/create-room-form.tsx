"use client";

import { useState, useTransition } from "react";
import { createRoomAction } from "@/app/actions/rooms";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { InviteCodeCard } from "./invite-code-card";

export function CreateRoomForm({ defaultNickname }: { defaultNickname: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nickname, setNickname] = useState(defaultNickname);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ roomId: string; inviteCode: string } | null>(null);
  const [pending, start] = useTransition();

  if (created) {
    return (
      <div className="space-y-4">
        <Notice tone="success" title="모임을 만들었어요">
          참여자에게 아래 코드를 알려 주세요. 기본 질문 5개와 기본 설정(초기 토큰 10개 등)이 적용되었습니다.
        </Notice>
        <InviteCodeCard code={created.inviteCode} />
        <LinkButton href={`/rooms/${created.roomId}`} size="lg">
          모임으로 이동
        </LinkButton>
      </div>
    );
  }

  return (
    <Card>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const result = await createRoomAction({ name, description, nickname });
            if (!result.ok) return setError(result.error);
            setCreated(result.data);
          });
        }}
      >
        <Field label="모임 이름" htmlFor="room-name">
          <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </Field>
        <Field label="설명 (선택)" htmlFor="room-desc" hint="참여자에게 보이는 짧은 소개예요.">
          <Textarea id="room-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        <Field label="내 닉네임" htmlFor="room-nickname">
          <Input id="room-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={20} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" size="lg" pending={pending}>
          모임 만들기
        </Button>
      </form>
    </Card>
  );
}
