'use client';

import Link from 'next/link';
import { Field, FieldLabel } from '@/components/ui/field';

export function ProgramDeadlineControl({
  id,
  enabled,
  onEnabledChange,
  persistedEnabled = false,
  notificationsHref,
}: {
  readonly id: string;
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly persistedEnabled?: boolean;
  readonly notificationsHref?: string;
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
      {!enabled ? (
        <p className="text-small text-muted-foreground">
          자동 알림을 사용하지 않습니다.
        </p>
      ) : null}
      {enabled && notificationsHref !== undefined && persistedEnabled ? (
        <Link
          href={notificationsHref}
          className="text-small w-fit font-semibold underline underline-offset-2 hover:opacity-80"
        >
          알림 페이지에서 보내기 →
        </Link>
      ) : null}
      {enabled && notificationsHref !== undefined && !persistedEnabled ? (
        <p className="text-small text-muted-foreground">
          저장하면 알림 페이지에서 발송할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
