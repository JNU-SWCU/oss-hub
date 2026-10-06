import { DialogShell } from '@/components';
import { formatSeoulDate } from './program-detail-format';

export function MilestoneDocumentResubmissionDialog({
  documentName,
  resubmissionDueAt,
  removedFileName = null,
  submitting,
  onCancel,
  onConfirm,
}: {
  readonly documentName: string;

  readonly resubmissionDueAt: string | null;
  readonly removedFileName?: string | null;
  readonly submitting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <DialogShell
      kind="alert"
      className="max-w-lg"
      title="제출하면 더 이상 바꿀 수 없습니다"
      description={`${documentName} 제출 항목을 보완 요청에 응해 다시 제출합니다. 보낸 뒤에는 담당 교직원의 검토가 끝날 때까지 내용을 바꿀 수 없습니다. 되돌릴 수 없습니다.${
        resubmissionDueAt === null
          ? ''
          : ` 재제출 기한(${formatSeoulDate(resubmissionDueAt)})이 남아 있어도 마찬가지입니다.`
      }`}
      busy={submitting}
      confirmLabel={submitting ? '제출하는 중…' : '제출 확정'}
      onCancel={onCancel}
      onSave={onConfirm}
    >
      {removedFileName === null ? null : (
        <p className="break-keep text-body">
          새 파일 없이 제출하면 기존 첨부{' '}
          <strong className="break-all">{removedFileName}</strong>는 최신
          제출본에서 빠집니다.
        </p>
      )}
    </DialogShell>
  );
}
