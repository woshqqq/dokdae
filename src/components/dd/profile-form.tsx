"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { updateProfileAction } from "@/app/actions/dd";
import { PersonAvatar } from "@/components/dd/person-avatar";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

const MAX_EDGE = 800;

/** 휴대폰 사진은 크기가 크므로 올리기 전에 긴 변 800px JPEG로 줄인다(서버 한도 1MB). 서버는 크기·형식을 다시 검증한다. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.8),
  );
}

export function ProfileForm({
  roomId,
  me,
}: {
  roomId: string;
  me: { id: string; nickname: string; bio: string; hasPhoto: boolean };
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(me.nickname);
  const [bio, setBio] = useState(me.bio);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setMessage(null);
    setUploading(true);
    try {
      const blob = await shrink(file);
      const form = new FormData();
      form.set("roomId", roomId);
      form.set("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/dd/photo", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return setMessage({ tone: "error", text: body?.error ?? "사진을 올리지 못했어요." });
      }
      setMessage({ tone: "success", text: "사진을 저장했어요." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "이미지를 읽지 못했어요. 다른 사진을 골라 주세요." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <PersonAvatar roomId={roomId} id={me.id} nickname={nickname || me.nickname} hasPhoto={me.hasPhoto} size="lg" />
        <div className="space-y-1">
          <input
            ref={fileRef}
            id="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="프로필 사진 선택"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="secondary" size="sm" pending={uploading} onClick={() => fileRef.current?.click()}>
            {me.hasPhoto ? "사진 바꾸기" : "사진 올리기"}
          </Button>
          <p className="text-xs text-muted">같은 방 참가자에게만 보여요. JPG·PNG·WebP</p>
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          start(async () => {
            const result = await updateProfileAction(roomId, { nickname, bio });
            if (!result.ok) return setMessage({ tone: "error", text: result.error });
            setMessage({ tone: "success", text: "프로필을 저장했어요." });
            router.refresh();
          });
        }}
      >
        <Field label="닉네임" htmlFor="nickname">
          <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={20} />
        </Field>
        <Field label="간단한 자기소개" htmlFor="bio" hint="독대를 시작하기로 한 상대에게만 보여요. (300자 이하)">
          <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} />
        </Field>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button type="submit" size="lg" pending={pending}>
          프로필 저장
        </Button>
      </form>
    </div>
  );
}
