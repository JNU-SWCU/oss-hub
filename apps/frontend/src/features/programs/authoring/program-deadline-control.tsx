'use client';

import { Field, FieldLabel } from '@/components/ui/field';
import { DeadlineDigestAction, ProgramMailAction } from '../notifications';

export function ProgramDeadlineControl({
  id,
  enabled,
  onEnabledChange,
  programId,
}: {
  readonly id: string;
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly programId?: string;
}) {
  return (
    <div className="grid min-w-0 gap-4" data-testid="program-deadline-control">
      <Field orientation="horizontal">
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <div className="grid gap-1">
          <FieldLabel htmlFor={id}>제출 마감 알림</FieldLabel>
          <p className="text-small text-muted-foreground">
            켜면 마감까지 24시간 이내인 필수 서류의 미제출 참여자에게 알림을
            보냅니다.
          </p>
        </div>
      </Field>
      {programId === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <ProgramMailAction programId={programId} />
          <DeadlineDigestAction programId={programId} enabled={enabled} />
        </div>
      )}
    </div>
  );
}
