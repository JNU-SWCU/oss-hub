import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components';
import type { ProgramDeletionScopeCounts } from './api';
import { ProgramPurgeSummary } from './program-edit-purge-summary';

interface ProgramEditPurgeConfirmationProps {
  readonly programName: string;
  readonly busy: boolean;
  readonly purgeCounts: ProgramDeletionScopeCounts | null;
  readonly isPurgeScopeLoading: boolean;
  readonly purgeScopeError: string | null;
  readonly purgeError: string | null;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/**
 * 프로그램 전체 삭제 확인 창.
 *
 * 되돌릴 수 없는 결정이라 공용 껍데기의 `kind="alert"`를 쓴다. 바닥 줄은 확정 버튼이
 * `destructive`이고 취소와 비활성 조건이 서로 달라 `footer`로 직접 준다 — 기본
 * 「취소 · 저장」 줄로는 그 둘을 나눠 줄 자리가 없다.
 *
 * 초점 복귀는 이 창이 맡지 않는다. 삭제 섹션이 `onClose`에서 트리거로 돌려준다.
 */
export function ProgramEditPurgeConfirmation({
  programName,
  busy,
  purgeCounts,
  isPurgeScopeLoading,
  purgeScopeError,
  purgeError,
  onConfirm,
  onClose,
}: ProgramEditPurgeConfirmationProps) {
  const canConfirm = !busy && !isPurgeScopeLoading && purgeCounts !== null;

  return (
    <DialogShell
      kind="alert"
      title="프로그램을 삭제할까요?"
      description={`${programName} 프로그램과 연결된 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
      busy={busy}
      // 원래 폭을 지킨다 — 껍데기 기본 md 는 max-w-xl 이다.
      className="max-w-lg"
      onCancel={onClose}
      footer={
        <>
          {/* 껍데기의 버튼은 스스로 닫지 않는다 — 예전 `AlertDialog.Cancel`이 하던 닫기를 여기서 부른다. */}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {isPurgeScopeLoading
              ? '삭제 범위 확인 중…'
              : busy
                ? '삭제 중…'
                : '삭제'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground [word-break:keep-all]">
        감사 기록과 사용자 계정은 유지됩니다.
      </p>
      {isPurgeScopeLoading ? (
        <Alert>
          <AlertTitle>삭제될 데이터</AlertTitle>
          <AlertDescription>삭제 범위를 확인하는 중입니다.</AlertDescription>
        </Alert>
      ) : null}
      {purgeCounts ? <ProgramPurgeSummary counts={purgeCounts} /> : null}
      {purgeScopeError ? (
        <Alert variant="destructive">
          <AlertTitle>삭제 범위를 확인하지 못했습니다</AlertTitle>
          <AlertDescription>{purgeScopeError}</AlertDescription>
        </Alert>
      ) : null}
      {purgeError ? (
        <Alert variant="destructive">
          <AlertTitle>전체 삭제 실패</AlertTitle>
          <AlertDescription>{purgeError}</AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}
