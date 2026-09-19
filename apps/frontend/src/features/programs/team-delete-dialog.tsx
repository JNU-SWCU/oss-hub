'use client';

import { useState, type ReactElement, type RefObject } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { deleteStaffProgramTeam } from './api';
import { ProgramAuthoringDialog } from './program-authoring-dialog';
import {
  formatTeamDeletedCounts,
  teamDeleteErrorMessage,
  teamDeleteScopeChangedCounts,
} from './team-delete-flow';
import type { TeamDeletionScope } from './types';

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
 * 껍데기는 이 폴더가 이미 쓰는 `ProgramAuthoringDialog`다 — 제목·본문·취소 줄·`busy`
 * 동안 닫기 차단·초점 복귀가 전부 그 안에 있다.
 *
 * 삭제는 이 창이 직접 한다. 화면에 마지막으로 보여 준 `scope`를 그대로 `expectedScope`로
 * 보낸다. 409(TEAM_019)가 오면 자동 재시도하지 않고 새 카운트로 다시 확인하게 한다.
 */
export function TeamDeleteDialog({
  programId,
  teamId,
  teamName,
  scope,
  returnFocusRef,
  onDeleted,
  onCancel,
}: {
  readonly programId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly scope: TeamDeletionScope;
  /** 창을 연 버튼. 닫을 때 그리로 초점을 돌려준다. */
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onDeleted: (summary: string) => void;
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
    <ProgramAuthoringDialog
      title="팀을 삭제할까요?"
      description={`${teamName} 팀과 연결된 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
      busy={busy}
      returnFocusRef={returnFocusRef}
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
    </ProgramAuthoringDialog>
  );
}
