import { DialogShell } from '@/components';

export function ProgramAuthoringConfirmationDialog({
  submitting,
  onCancel,
  onConfirm,
}: {
  readonly submitting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <DialogShell
      kind="alert"
      title="프로그램을 생성하시겠습니까?"
      description="마일스톤, 제출 항목, 선택한 양식 파일을 포함한 전체 내용이 한 번에 생성됩니다."
      busy={submitting}

      className="max-w-lg"

      bodyClassName="mt-0"
      confirmLabel={submitting ? '생성 중…' : '생성 확정'}
      onCancel={onCancel}
      onSave={onConfirm}
    >
      {null}
    </DialogShell>
  );
}
