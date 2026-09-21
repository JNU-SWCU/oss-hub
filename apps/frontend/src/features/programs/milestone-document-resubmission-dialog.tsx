import { DialogShell } from '@/components';
import { formatSeoulDate } from './program-detail-format';

/**
 * 마감 뒤 보완 요청에 응하는 **되돌릴 수 없는 제출**을 확인받는 창.
 *
 * 어휘는 이 저장소에 이미 있는 되돌릴 수 없는 행동들에서 그대로 가져온다 — 프로그램 생성
 * (`ProgramAuthoringConfirmationDialog`)·프로그램 내리기(`ProgramEditLifecycleSection`)·서류
 * 항목 삭제(`milestone-document-row.tsx`)가 쓰는 말이다.
 * - 껍데기: 공용 `DialogShell`의 `kind="alert"`(R-06). 되돌릴 수 없는 결정이라
 *   docs/design.md의 피드백 표가 `role="alertdialog"`를 요구하고, 바깥을 잘못 눌러
 *   사라지지도 않아야 한다 — 그 두 가지가 `kind="alert"`가 하는 일이다.
 * - 「되돌릴 수 없습니다」 — 서류 항목 삭제 확인 문구 그대로.
 * - 「취소」 — 확정하지 않고 확인창을 닫는 공통 이름이다.
 * - 「제출 확정」 — 「생성 확정」·「삭제 확정」과 같은 짜임.
 *
 * 색은 만들지 않는다. 확인 버튼은 기본(주조색) `Button`이다 — `destructive`를 쓰지 않는 것은
 * 게시 상태 전환이 그것을 쓰지 않는 것과 같은 이유다: **파괴가 아니라 확정**이고, 삭제와 같은
 * 색·같은 무게로 그리면 두 행동의 차이가 사라진다.
 *
 * 닫는 일은 부르는 화면이 한다(`onCancel`·`onConfirm`이 `pendingDraft`를 비운다).
 * 폭은 `max-w-lg`로 못 박는다 — 껍데기 기본(`max-w-xl`)보다 좁은 원래 폭이다.
 */
export function MilestoneDocumentResubmissionDialog({
  documentName,
  resubmissionDueAt,
  removedFileName = null,
  submitting,
  onCancel,
  onConfirm,
}: {
  readonly documentName: string;
  /**
   * 교직원이 정한 재제출 기한. 이 값이 생기기 전에 저장된 보완 요청이면 `null`이고, 그때는
   * 기한 문장을 아예 적지 않는다 — 없는 기한을 지어내 적으면 그것이 곧 거짓말이 된다.
   */
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
