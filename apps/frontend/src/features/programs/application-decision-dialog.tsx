'use client';

import { Button } from '@/components/ui/button';
import type {
  ApplicationDecisionAction,
  RepositoryConnectionMode,
} from './types';

/**
 * 신청 판정 확인창. 목록(`program-applicants-page`)과 상세
 * (`program-application-detail-page`) 두 화면이 **같은 것을 쓴다** — 교직원이 두 화면을
 * 오가며 판정하는데 확인 문구·검증 시점이 갈리면 같은 조작이 다르게 느껴진다.
 *
 * 상태는 갖지 않는다. 사유 입력값과 진행 중 여부는 부르는 화면이 들고 있다 —
 * 목록은 판정 뒤 페이지를 다시 읽고 상세는 그 한 건을 다시 읽어야 해서, 성공 후에
 * 할 일이 서로 다르기 때문이다.
 */
export function ApplicationDecisionDialog({
  action,
  repositoryProvisioningEnabled,
  repositoryConnectionMode,
  reason,
  reasonError,
  busy,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  readonly action: ApplicationDecisionAction;
  readonly repositoryProvisioningEnabled: boolean;
  /**
   * `OWN`이면 승인이 저장소를 **새로 만들지 않는다** — 신청자가 낸 저장소를 잇는다.
   * 프로그램의 자동 생성 스위치만 보고 「생성합니다」라고 말하면 사실과 다르다.
   */
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly reason: string;
  readonly reasonError: boolean;
  readonly busy: boolean;
  readonly onReasonChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-title"
    >
      <div className="grid w-full max-w-md gap-4 rounded-xl bg-background p-6 shadow-lg">
        <h2 id="decision-title" className="text-lg font-semibold">
          {action === 'APPROVE'
            ? '신청 승인'
            : action === 'REJECT'
              ? '신청 반려'
              : '판정 되돌리기'}
        </h2>
        {action === 'APPROVE' ? (
          <p className="break-keep">
            {repositoryConnectionMode === 'OWN'
              ? '승인하면 신청자가 낸 저장소를 연결합니다. 새 저장소를 만들지 않습니다.'
              : repositoryProvisioningEnabled
                ? '승인하면 저장소 자동 생성이 활성화되어 저장소 작업을 시작합니다.'
                : '승인하면 저장소 자동 생성이 비활성화되어 저장소를 생성하지 않습니다.'}
          </p>
        ) : action === 'REJECT' ? (
          /*
           * 라벨·오류·안내를 `<label>` **바깥**에 둔다. `<label>`이 감싸면 그 안의
           * 글자가 전부 입력칸의 이름이 되어, 스크린리더가 "반려 사유 반려 사유를
           * 입력해 주세요 적은 사유는 학생에게…"를 이름으로 읽는다. 오류가 이름
           * 안에 묻히면 무엇이 라벨이고 무엇이 오류인지 갈리지 않는다.
           */
          <div className="grid gap-2 text-sm">
            <label htmlFor="rejection-reason">반려 사유</label>
            <textarea
              id="rejection-reason"
              className="min-h-28 rounded-md border border-input bg-background p-3"
              value={reason}
              disabled={busy}
              onChange={(event) => onReasonChange(event.target.value)}
              aria-invalid={reasonError}
              aria-describedby={
                reasonError ? 'reason-error reason-hint' : 'reason-hint'
              }
            />
            {reasonError ? (
              <span id="reason-error" className="text-destructive">
                반려 사유를 입력해 주세요.
              </span>
            ) : null}
            {/*
             * 사유가 학생에게 간다는 사실을 **누르기 전에** 말한다(서류 판정 패널과
             * 같은 규칙). 이 고지가 없으면 교직원은 내부 메모처럼 적는다.
             */}
            <span id="reason-hint" className="text-muted-foreground break-keep">
              적은 사유는 학생에게 그대로 보입니다.
            </span>
          </div>
        ) : (
          <p>
            판정을 취소하고 신청을 다시 제출됨 상태로 되돌립니다. 이후
            승인·반려를 다시 할 수 있습니다.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            취소
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy
              ? '처리 중…'
              : action === 'APPROVE'
                ? '승인 확정'
                : action === 'REJECT'
                  ? '반려 확정'
                  : '되돌리기 확정'}
          </Button>
        </div>
      </div>
    </div>
  );
}
