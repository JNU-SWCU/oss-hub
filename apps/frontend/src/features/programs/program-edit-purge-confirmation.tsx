import { AlertDialog } from 'radix-ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <AlertDialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto outline-none">
          <Card className="shadow-xl">
            <CardHeader>
              <AlertDialog.Title asChild>
                <CardTitle>프로그램을 삭제할까요?</CardTitle>
              </AlertDialog.Title>
            </CardHeader>
            <CardContent className="grid gap-5">
              <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                <span className="font-semibold text-foreground">
                  {programName}
                </span>{' '}
                프로그램과 연결된 데이터를 삭제합니다. 이 작업은 되돌릴 수
                없습니다.
              </AlertDialog.Description>
              <p className="text-sm text-muted-foreground [word-break:keep-all]">
                감사 기록과 사용자 계정은 유지됩니다.
              </p>
              {isPurgeScopeLoading ? (
                <Alert>
                  <AlertTitle>삭제될 데이터</AlertTitle>
                  <AlertDescription>
                    삭제 범위를 확인하는 중입니다.
                  </AlertDescription>
                </Alert>
              ) : null}
              {purgeCounts ? (
                <ProgramPurgeSummary counts={purgeCounts} />
              ) : null}
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
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <Button type="button" variant="outline" disabled={busy}>
                    취소
                  </Button>
                </AlertDialog.Cancel>
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
              </div>
            </CardContent>
          </Card>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
