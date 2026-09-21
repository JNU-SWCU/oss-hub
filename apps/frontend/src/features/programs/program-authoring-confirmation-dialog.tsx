import { DialogShell } from '@/components';

/**
 * 프로그램 생성 확정 창.
 *
 * 되돌릴 수 없는 결정이라 공용 껍데기의 `kind="alert"`를 쓴다 — 바깥을 잘못 눌러
 * 사라지지 않고, 낭독기에 `alertdialog`로 알린다. 확정 중에는 `busy`가 닫기를 막는다.
 */
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
      // 원래 폭을 지킨다 — 껍데기 기본 md 는 max-w-xl 이다.
      className="max-w-lg"
      // 본문이 없는 창이다. 빈 본문의 위 여백까지 두면 설명과 버튼 줄 사이가 원래보다 벌어진다.
      bodyClassName="mt-0"
      confirmLabel={submitting ? '생성 중…' : '생성 확정'}
      onCancel={onCancel}
      onSave={onConfirm}
    >
      {null}
    </DialogShell>
  );
}
