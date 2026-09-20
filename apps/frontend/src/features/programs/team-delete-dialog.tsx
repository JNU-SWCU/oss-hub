'use client';

import { AlertDialog } from 'radix-ui';
import { useState, type ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ALERT_DIALOG_SHELL_CLASS } from '@/components/ui/dialog';
import { deleteStaffProgramTeam } from './api';
import {
  formatTeamDeletedCounts,
  teamDeleteErrorMessage,
  teamDeleteScopeChangedCounts,
} from './team-delete-flow';
import type { TeamDeletionScope } from './types';

/** backend `DeleteTeamRequestDto` 의 `@MaxLength(500)` 과 같은 값이어야 400 을 받지 않는다. */
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

/**
 * 팀 삭제 확인 창.
 *
 * 껍데기는 프로그램 삭제 확인창(`ProgramEditPurgeConfirmation`)과 같은 alertdialog다.
 * 공용 `DialogShell`을 쓰지 않는다 — design.md가 되돌릴 수 없는 결정의 확인은
 * alertdialog 변형으로 묶어 둔다. 그 변형이 공용으로 올라올 때 두 창이 같은 자리에서
 * 함께 옮겨가도록 구조를 그쪽과 글자 단위로 맞춰 둔다.
 *
 * 삭제는 이 창이 직접 한다. 화면에 마지막으로 보여 준 `scope`를 그대로 `expectedScope`로
 * 보낸다. 409(TEAM_019)가 오면 자동 재시도하지 않고 새 카운트로 다시 확인하게 한다.
 */
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
  /** 닫기·취소. 초점을 트리거로 되돌리는 것은 프로그램 삭제창처럼 부르는 화면이 맡는다. */
  readonly onCancel: () => void;
}): ReactElement {
  /**
   * 확인 창이 지금 말하고 있는 범위.
   * 409로 갱신되면 이 값이 다음 요청의 `expectedScope`가 된다.
   */
  const [displayedScope, setDisplayedScope] = useState(scope);
  const [busy, setBusy] = useState(false);
  const [scopeChangedMessage, setScopeChangedMessage] = useState<string | null>(
    null,
  );
  /**
   * 실패는 창 **안에서** 말한다. 화면 위쪽 알림에 그리면 이 창 뒤에 가려
   * 아무 일도 안 일어난 것처럼 보인다.
   */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /**
   * 팀원에게 함께 보낼 교직원 문구. 선택이다 — 비워도 삭제 사실은 알림으로 나간다.
   * 여기 적는 것은 「무엇을 더 말할 것인가」일 뿐이다.
   */
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
    <AlertDialog.Root
      open
      onOpenChange={(next) => {
        // 삭제가 도는 동안에는 닫지 않는다 — 화면만 먼저 사라지면 결과를 볼 자리가 없다.
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <AlertDialog.Content className={ALERT_DIALOG_SHELL_CLASS}>
          <Card className="shadow-xl">
            <CardHeader>
              <AlertDialog.Title asChild>
                <CardTitle>팀을 삭제할까요?</CardTitle>
              </AlertDialog.Title>
            </CardHeader>
            <CardContent className="grid gap-5">
              <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                <span className="font-semibold text-foreground">
                  {teamName}
                </span>{' '}
                팀과 연결된 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.
              </AlertDialog.Description>
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
                {/*
                 * 알림 자체는 선택이 아니다 — 백엔드가 삭제와 같은 커밋에서 남긴다.
                 * 비워 두면 삭제 사실만 가고, 적으면 그 문구가 함께 간다.
                 */}
                <textarea
                  id="team-delete-notification-message"
                  className="min-h-[5rem] w-full rounded-control border border-input bg-transparent px-4 py-2 text-body outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  maxLength={MAX_NOTIFICATION_MESSAGE_LENGTH}
                  disabled={busy}
                  value={notificationMessage}
                  placeholder="비워 두면 삭제 사실만 알립니다."
                  onChange={(event) =>
                    setNotificationMessage(event.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {notificationMessage.length} /{' '}
                  {MAX_NOTIFICATION_MESSAGE_LENGTH}자
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
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <Button type="button" variant="outline" disabled={busy}>
                    취소
                  </Button>
                </AlertDialog.Cancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  {busy ? '삭제 중…' : '삭제'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
