'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogDescription } from '@/components/ui/dialog';
import { DialogShell } from '@/components';
import type { ApplicationDecisionAction, ApplicationStatus } from './types';

export function ApplicationDecisionDialog({
  action,
  currentStatus,
  applicantName,
  teamName,
  reason,
  reasonError,
  busy,
  errorMessage,
  returnFocusId,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  readonly action: Exclude<ApplicationDecisionAction, 'REVERT'>;

  readonly currentStatus: ApplicationStatus;

  readonly applicantName: string;

  readonly teamName: string | null;
  readonly reason: string;
  readonly reasonError: boolean;
  readonly busy: boolean;

  readonly errorMessage: string | null;

  readonly returnFocusId: string;
  readonly onReasonChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const isReject = action === 'REJECT';

  const returnFocusRef = {
    get current(): HTMLElement | null {
      return document.getElementById(returnFocusId);
    },
  };

  return (
    <DialogShell
      kind="alert"
      title={isReject ? '신청 반려' : '신청 승인'}

      className="max-w-md"

      bodyClassName="*:min-w-0"

      busy={busy}
      returnFocusRef={returnFocusRef}
      onCancel={onCancel}
      footer={
        <>
          <Button
            variant="outline"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            취소
          </Button>

          <Button disabled={busy} onClick={onConfirm}>
            {busy ? '처리 중…' : isReject ? '반려 확정' : '승인 확정'}
          </Button>
        </>
      }
    >
      <dl
        id="application-decision-summary"
        className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-small"
      >
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">신청자</dt>
          <dd className="break-keep font-medium text-foreground [overflow-wrap:anywhere]">
            {applicantName}
          </dd>
        </div>
        {teamName !== null ? (
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">팀</dt>
            <dd className="break-keep text-muted-foreground [overflow-wrap:anywhere]">
              {teamName}
            </dd>
          </div>
        ) : null}
      </dl>
      {!isReject ? (
        <DialogDescription className="text-body text-foreground break-keep">
          {currentStatus === 'REJECTED'
            ? '이미 반려한 신청입니다. 판정을 승인으로 바꾸면 지금 남아 있는 반려 사유는 지워집니다. '
            : ''}
          승인하면 이 신청이 프로그램 참여로 확정됩니다.
        </DialogDescription>
      ) : (
        <>
          <DialogDescription
            data-testid="application-decision-reject-consequence"
            className="rounded-md border border-border bg-muted/40 p-3 text-small text-foreground break-keep text-pretty"
          >
            반려하면 신청자가 신청서를 고쳐 다시 낼 수 있고, 다시 내면 검토
            대기로 돌아옵니다. 교직원이 나중에 이 신청을 바로 승인할 수도
            있습니다.
          </DialogDescription>

          <div className="grid gap-2 text-sm">
            {currentStatus === 'APPROVED' ? (
              <p className="break-keep">
                이미 승인한 신청입니다. 확정하면 검토 대기를 거치지 않고 곧바로
                반려로 바뀝니다.
              </p>
            ) : null}
            <label htmlFor="rejection-reason">반려 사유</label>
            <textarea
              id="rejection-reason"
              className="min-h-28 rounded-md border border-input bg-background p-3"
              value={reason}
              disabled={busy}
              onChange={(event) => onReasonChange(event.target.value)}
              aria-invalid={reasonError}
              aria-describedby={
                reasonError ? 'reason-error reason-hint' : 'reason-hint'
              }
            />
            {reasonError ? (
              <span id="reason-error" role="alert" className="text-destructive">
                반려 사유를 입력해 주세요.
              </span>
            ) : null}

            <span id="reason-hint" className="text-muted-foreground break-keep">
              적은 사유는 학생에게 그대로 보입니다.
            </span>
          </div>
        </>
      )}
      {errorMessage !== null ? (
        <Alert variant="destructive">
          <AlertTitle>저장하지 못했습니다</AlertTitle>
          <AlertDescription className="[word-break:keep-all]">
            {errorMessage}
          </AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}
