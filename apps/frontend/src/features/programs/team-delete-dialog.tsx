'use client';

import { useState, type ReactElement } from 'react';
import { DialogShell } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { deleteStaffProgramTeam } from './api';
import {
  formatTeamDeletedCounts,
  teamDeleteErrorMessage,
  teamDeleteScopeChangedCounts,
} from './team-delete-flow';
import type { TeamDeletionScope } from './types';

const MAX_NOTIFICATION_MESSAGE_LENGTH = 500;

const DISAPPEARING_ITEMS = [
  ['applications', '지원서', '건'],
  ['members', '팀원', '명'],
  ['invitations', '초대', '건'],
  ['submissions', '제출물', '건'],
  ['submissionEvents', '제출 이력', '건'],
] as const satisfies ReadonlyArray<
  readonly [
    keyof Omit<TeamDeletionScope, 'detachedRepositories' | 'scopeFingerprint'>,
    string,
    string,
  ]
>;

export function TeamDeleteDialog({
  programId,
  teamId,
  teamName,
  scope,
  onDeleted,
  onCancel,
}: {
  readonly programId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly scope: TeamDeletionScope;
  readonly onDeleted: (summary: string) => void;

  readonly onCancel: () => void;
}): ReactElement {
  const [displayedScope, setDisplayedScope] = useState(scope);
  const [busy, setBusy] = useState(false);
  const [scopeChangedMessage, setScopeChangedMessage] = useState<string | null>(
    null,
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [notificationMessage, setNotificationMessage] = useState('');

  const disappearing = DISAPPEARING_ITEMS.filter(
    ([key]) => displayedScope[key] > 0,
  )
    .map(([key, label, unit]) => `${label} ${displayedScope[key]}${unit}`)
    .join(' · ');

  async function confirm(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    setScopeChangedMessage(null);
    try {
      const result = await deleteStaffProgramTeam(
        programId,
        teamId,
        displayedScope,
        notificationMessage,
      );
      onDeleted(formatTeamDeletedCounts(result.deletedCounts));
    } catch (error: unknown) {
      const changedCounts = teamDeleteScopeChangedCounts(error);
      if (changedCounts) {
        setDisplayedScope(changedCounts);
        setScopeChangedMessage(
          '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 삭제를 다시 눌러 주세요.',
        );
      } else {
        setErrorMessage(teamDeleteErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      kind="alert"
      title="팀을 삭제할까요?"
      description={`${teamName} 팀과 연결된 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}

      className="max-w-lg"

      busy={busy}
      onCancel={onCancel}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            취소
          </Button>

          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? '삭제 중…' : '삭제'}
          </Button>
        </>
      }
    >
      <Alert>
        <AlertTitle>삭제될 데이터</AlertTitle>
        <AlertDescription className="[word-break:keep-all]">
          {disappearing || '연결된 데이터 없음'}
        </AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground [word-break:keep-all]">
        연결된 GitHub 저장소는 삭제하지 않고 연결만 해제합니다
        {displayedScope.detachedRepositories > 0
          ? ` (${displayedScope.detachedRepositories}건).`
          : '.'}
      </p>
      <div className="grid gap-2">
        <label
          htmlFor="team-delete-notification-message"
          className="text-small font-medium"
        >
          팀원에게 보낼 안내 (선택)
        </label>

        <Textarea
          id="team-delete-notification-message"
          maxLength={MAX_NOTIFICATION_MESSAGE_LENGTH}
          disabled={busy}
          value={notificationMessage}
          placeholder="비워 두면 삭제 사실만 알립니다."
          onChange={(event) => setNotificationMessage(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {notificationMessage.length} / {MAX_NOTIFICATION_MESSAGE_LENGTH}자
        </p>
      </div>
      {scopeChangedMessage !== null ? (
        <Alert variant="destructive">
          <AlertTitle>삭제 범위가 변경되었습니다</AlertTitle>
          <AlertDescription className="[word-break:keep-all]">
            {scopeChangedMessage}
          </AlertDescription>
        </Alert>
      ) : null}
      {errorMessage !== null ? (
        <Alert variant="destructive">
          <AlertTitle>삭제하지 못했습니다</AlertTitle>
          <AlertDescription className="[word-break:keep-all]">
            {errorMessage}
          </AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}
