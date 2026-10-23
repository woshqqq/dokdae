"use client";

import { useState, useTransition } from "react";
import { updateRoomSettingsAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Switch } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { roomSettingsSchema } from "@/lib/data/settings";
import type { RoomSettings } from "@/lib/data/types";
import { fieldErrorsOf } from "@/lib/zod-errors";

type NumberKey = { [K in keyof RoomSettings]: RoomSettings[K] extends number ? K : never }[keyof RoomSettings];
type BoolKey = { [K in keyof RoomSettings]: RoomSettings[K] extends boolean ? K : never }[keyof RoomSettings];

export function SettingsForm({ roomId, initial }: { roomId: string; initial: RoomSettings }) {
  const [values, setValues] = useState<RoomSettings>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const num = (key: NumberKey, label: string, opts: { hint?: string; unit?: string } = {}) => (
    <Field label={label} htmlFor={`s-${key}`} hint={opts.hint} error={errors[key]}>
      <div className="flex items-center gap-2">
        <Input
          id={`s-${key}`}
          type="number"
          inputMode="numeric"
          value={Number.isNaN(values[key]) ? "" : values[key]}
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value === "" ? Number.NaN : Number(e.target.value) }))}
          aria-invalid={Boolean(errors[key]) || undefined}
          aria-describedby={errors[key] ? `s-${key}-error` : opts.hint ? `s-${key}-hint` : undefined}
          className="max-w-32"
        />
        {opts.unit ? <span className="text-sm text-muted">{opts.unit}</span> : null}
      </div>
    </Field>
  );
  const bool = (key: BoolKey, label: string, description?: string) => (
    <Switch
      id={`s-${key}`}
      label={label}
      description={description}
      checked={values[key]}
      onChange={(checked) => setValues((v) => ({ ...v, [key]: checked }))}
    />
  );

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setStatus(null);
        const parsed = roomSettingsSchema.safeParse(values);
        if (!parsed.success) {
          setErrors(fieldErrorsOf(parsed.error));
          setStatus({ tone: "error", text: "표시된 항목을 확인해 주세요." });
          return;
        }
        setErrors({});
        start(async () => {
          const r = await updateRoomSettingsAction(roomId, parsed.data);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            setStatus({ tone: "error", text: r.error });
            return;
          }
          setStatus({ tone: "success", text: r.message ?? "저장했습니다." });
        });
      }}
    >
      <Card className="space-y-4">
        <h3 className="font-bold">토큰</h3>
        {num("initialTokens", "신규 참여자 초기 토큰", { unit: "개", hint: "이미 참여한 사람에게는 소급 지급하지 않아요." })}
      </Card>

      <Card className="space-y-4">
        <h3 className="font-bold">질문 열람 비용</h3>
        <div className="grid grid-cols-2 gap-3">
          {num("minQuestionCost", "최솟값", { unit: "토큰" })}
          {num("maxQuestionCost", "최댓값", { unit: "토큰" })}
        </div>
        {num("defaultQuestionCost", "새 질문의 기본 비용", { unit: "토큰", hint: "참여자는 범위 안에서 질문마다 비용을 바꿀 수 있어요." })}
        {bool("customQuestionsEnabled", "참여자 직접 질문 추가", "참여자가 자기 프로필에 질문을 직접 만들 수 있어요.")}
      </Card>

      <Card className="space-y-4">
        <h3 className="font-bold">토큰 보내기</h3>
        {bool("giftsEnabled", "토큰 보내기 사용", "독대 중 질문 열기와 별개로 토큰을 보낼 수 있어요.")}
        <div className="grid grid-cols-3 gap-3">
          {num("giftMinAmount", "최소")}
          {num("giftDefaultAmount", "기본")}
          {num("giftMaxAmount", "최대")}
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-bold">독대</h3>
        {num("maxActiveSessionsPerMember", "참여자당 동시 진행 독대 수", { unit: "개" })}
        {num("requestExpiryMinutes", "독대 요청 만료 시간", { unit: "분" })}
        {bool("memberListVisible", "참여자 목록 공개", "끄면 운영자만 참여자 목록을 볼 수 있어요.")}
      </Card>

      <Card className="space-y-4">
        <h3 className="font-bold">기록 보관</h3>
        {num("sessionRetentionDays", "종료된 독대 기록 보관", {
          unit: "일",
          hint: "0이면 종료 즉시 열람·거래 기록을 삭제해요. 보관 중에도 답변은 공개되지 않아요.",
        })}
        {num("roomRetentionDays", "종료된 모임 데이터 보관", { unit: "일", hint: "0이면 모임 종료 즉시 프로필·답변·지갑을 삭제해요." })}
      </Card>

      {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}
      <Button type="submit" size="lg" pending={pending}>
        설정 저장
      </Button>
    </form>
  );
}
