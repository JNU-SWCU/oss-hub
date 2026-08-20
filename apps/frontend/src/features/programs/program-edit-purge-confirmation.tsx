import { AlertDialog } from 'radix-ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ProgramDeleteBlockingCounts } from './program-edit-delete-flow';
import { ProgramPurgeSummary } from './program-edit-purge-summary';

interface ProgramEditPurgeConfirmationProps {
  readonly programName: string;
  readonly confirmText: string;
  readonly busy: boolean;
  readonly purgeCounts: ProgramDeleteBlockingCounts | null;
  readonly isPurgeScopeLoading: boolean;
  readonly purgeScopeError: string | null;
  readonly purgeError: string | null;
  readonly onConfirmTextChange: (value: string) => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function ProgramEditPurgeConfirmation({
  programName,
  confirmText,
  busy,
  purgeCounts,
  isPurgeScopeLoading,
  purgeScopeError,
  purgeError,
  onConfirmTextChange,
  onConfirm,
  onClose,
}: ProgramEditPurgeConfirmationProps) {
  const canConfirm =
    confirmText === programName &&
    !busy &&
    !isPurgeScopeLoading &&
    purgeCounts !== null;

  return (
    <AlertDialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
          <Card className="shadow-xl">
            <CardHeader>
              <AlertDialog.Title asChild>
                <CardTitle>프로그램을 영구히 삭제할까요?</CardTitle>
              </AlertDialog.Title>
            </CardHeader>
            <CardContent className="grid gap-5">
              <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                연결된 지원서, 팀, 게시글, 제출물과 관련 기록을 모두 삭제합니다.{' '}
                계속하려면 프로그램 이름{' '}
                <span className="font-semibold text-foreground">
                  {programName}
                </span>
                을(를) 아래에 그대로 입력해 주세요.
              </AlertDialog.Description>
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
              <Field>
                <FieldLabel htmlFor="program-purge-confirm-name">
                  프로그램 이름
                </FieldLabel>
                <Input
                  id="program-purge-confirm-name"
                  value={confirmText}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => onConfirmTextChange(event.target.value)}
                />
              </Field>
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
                    ? '삭제 범위를 확인하는 중…'
                    : busy
                      ? '삭제하는 중…'
                      : '프로그램 영구 삭제'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
