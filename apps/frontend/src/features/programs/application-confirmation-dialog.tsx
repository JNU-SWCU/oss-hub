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
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4">
      <Card
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="application-confirmation-title"
        aria-describedby="application-confirmation-description"
        className="w-full max-w-lg shadow-xl"
      >
        <CardHeader>
          <CardTitle id="application-confirmation-title">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p
            id="application-confirmation-description"
            className="text-sm leading-6 text-muted-foreground"
          >
            {description}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onClose}
            >
              돌아가서 확인
            </Button>
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
