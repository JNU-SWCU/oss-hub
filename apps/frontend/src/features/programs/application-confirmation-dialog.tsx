import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApplicationConfirmation } from './program-apply-views';

export function ApplicationConfirmationDialog({
  kind,
  submitting,
  onClose,
  onConfirm,
}: {
  readonly kind: Exclude<ApplicationConfirmation, null>;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const isCancellation = kind === 'cancel';
  const title = isCancellation
    ? '신청을 취소하시겠습니까?'
    : kind === 'save'
      ? '수정 내용을 저장하시겠습니까?'
      : '신청서를 제출하시겠습니까?';
  const description = isCancellation
    ? '신청을 취소하면 현재 신청서가 삭제됩니다. 다시 참여하려면 신청 기간 내에 새 신청서를 제출해야 합니다.'
    : kind === 'save'
      ? '저장한 내용은 담당자의 신청 검토 화면에 즉시 반영됩니다.'
      : '신청 기간 내 승인 대기 상태에서는 수정하거나 취소할 수 있지만, 승인된 이후에는 수정 및 취소가 불가능합니다. 제출 내용을 다시 확인해 주세요.';

  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
      <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
        <Card className="shadow-xl">
          <CardHeader>
            <AlertDialog.Title asChild>
              <CardTitle>{title}</CardTitle>
            </AlertDialog.Title>
          </CardHeader>
          <CardContent className="space-y-5">
            <AlertDialog.Description className="text-sm leading-6 text-muted-foreground">
              {description}
            </AlertDialog.Description>
            <div className="flex flex-wrap justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline" disabled={submitting}>
                  돌아가서 확인
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  type="button"
                  variant={isCancellation ? 'destructive' : 'default'}
                  disabled={submitting}
                  onClick={onConfirm}
                >
                  {submitting
                    ? '처리 중…'
                    : isCancellation
                      ? '신청 취소'
                      : kind === 'save'
                        ? '수정 내용 저장'
                        : '신청서 제출'}
                </Button>
              </AlertDialog.Action>
            </div>
          </CardContent>
        </Card>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
