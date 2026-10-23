"use client";

import { useState, useTransition } from "react";
import { updateRoomInfoAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function RoomInfoForm({ roomId, name: initialName, description: initialDesc }: { roomId: string; name: string; description: string }) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDesc);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setStatus(null);
          start(async () => {
            const r = await updateRoomInfoAction({ roomId, name, description });
            setStatus(r.ok ? { tone: "success", text: r.message ?? "저장했습니다." } : { tone: "error", text: r.error });
          });
        }}
      >
        <Field label="모임 이름" htmlFor="info-name">
          <Input id="info-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </Field>
        <Field label="설명" htmlFor="info-desc">
          <Textarea id="info-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
        <Button type="submit" pending={pending}>
          저장
        </Button>
      </form>
    </Card>
  );
}
