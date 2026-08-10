'use client';

import { AlertDialog } from 'radix-ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
 *
 * `AlertDialog`를 쓴다(`Dialog`가 아니다) — 되돌릴 수 없는 판정이고 사유를 쳐 넣은
 * 상태라, 바깥을 잘못 눌러 창이 닫히면 적던 글이 사라진다. 손으로 만들었던 옛 창도
 * 바깥 클릭으로 닫히지 않았으므로 동작이 바뀌지 않는다([#734]).
 *
 * ⚠ `Portal`을 쓰지 않는다 — 두 화면의 기존 테스트가 렌더 컨테이너 안에서 이 창의
 * 내용을 찾는다. 위치 지정은 어차피 `fixed`라 Portal 유무로 달라지지 않고,
 * 포커스 가둠·`aria-hidden`·스크롤 잠금은 Portal 없이도 그대로 걸린다.
 */
export function ApplicationDecisionDialog({
  action,
  repositoryProvisioningEnabled,
  repositoryConnectionMode,
  reason,
  reasonError,
  busy,
  errorMessage,
  returnFocusId,
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
  /**
   * 판정 저장이 실패했는데 창은 열려 있는 경우의 안내.
   * ⚠ 화면 위쪽 알림에 그리면 **이 창 뒤에 가려** 교직원이 못 본다 — 실패했는데
   * 아무 일도 안 일어난 것처럼 보인다. 그래서 창 안에서 말한다([#734]).
   */
  readonly errorMessage: string | null;
  /**
   * 창을 연 버튼의 id. 닫힐 때 그리로 포커스를 돌려준다(`submission-dialog.tsx`와 같은 규칙).
   *
   * ⚠ **취소·Escape 로 닫을 때의 자리다.** 화면이 창을 **스스로** 닫는 경우(판정 성공·
   *   낡은 상태)에는 그 순간 이 버튼이 아직 `disabled` 이고, 성공 뒤에는 아예 다른
   *   버튼으로 바뀐다(「승인」→「되돌리기」). 그때의 복귀는 재조회가 끝나는 시점을 아는
   *   화면 쪽이 맡는다(`application-decision-focus.ts`, [#767]).
   */
  readonly returnFocusId: string;
  readonly onReasonChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const isReject = action === 'REJECT';
  /*
   * 반려 창은 설명 문단 대신 입력 폼이라 가리킬 설명이 없다. 키를 **아예 넘기지 않아야**
   * 나머지 두 창에서 Radix 가 붙이는 설명 id 가 살아남는다(`undefined` 를 넘기면 그것까지 지운다).
   */
  const describedBy = isReject ? { 'aria-describedby': undefined } : {};
  return (
    <AlertDialog.Root
      open
      /*
       * 닫힘을 여기 한 곳에서만 판정한다 — Escape·취소 버튼이 모두 이리로 온다.
       * ⚠ 저장이 날아가는 중(`busy`)에는 닫지 않는다. 닫히면 적어 둔 사유를 잃고
       *   무엇이 저장됐는지도 알 수 없다.
       * `onEscapeKeyDown`으로 한 번 더 막지 않는다 — 창이 열려 있는지를 부르는 화면이
       *   쥐고 있어서 이 가드만으로 충분하고, 변이로 확인했다(빼도 동작이 같았다).
       */
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      {/*
       * ⚠ `Portal` 을 쓴다 — 창이 페이지 DOM 안에 있으면, **창이 열린 뒤에** 삽입되는
       *   형제(예: 화면 위쪽 알림)가 Radix 가 걸어 둔 `aria-hidden` 밖에 남는다.
       *   그러면 읽어 주는 도구가 창 뒤 경고를 함께 훑는다. 형제 창들과 같은 규칙.
       */}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <AlertDialog.Content
          {...describedBy}
          /*
           * ⚠ 창이 스스로 스크롤되어야 한다 — 뒤 화면 스크롤은 잠기므로, 창이 화면보다
           *   길어지면 버튼에 닿을 방법이 없다(반려 + 입력 오류 + 저장 실패가 겹친 상태가
           *   제일 길다). 형제 창들과 같은 규칙(`submission-dialog`·`program-type-modal`).
           */
          className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-background p-6 shadow-lg outline-none *:min-w-0"
          /*
           * ⚠ Radix 기본 복귀를 **언제나** 막는다 — 그것은 창이 열릴 때 포커스를 갖고
           *   있던 노드를 향하는데, 판정에 성공하면 그 버튼은 이미 DOM 에서 사라진
           *   뒤다(「승인」→「되돌리기」). 사라진 노드에 포커스를 주면 포커스는 문서
           *   맨 앞에 남고, 재조회 뒤에 화면이 옮겨 둔 포커스까지 덮어쓴다([#767]).
           *   이 복귀는 `setTimeout` 안에서 늦게 일어나므로 순서를 가정할 수 없다.
           *   버튼이 없거나 `disabled` 면 아무것도 안 하고 화면 쪽 복귀에 맡긴다.
           */
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(returnFocusId)?.focus();
          }}
        >
          <AlertDialog.Title asChild>
            <h2 className="text-lg font-semibold">
              {action === 'APPROVE'
                ? '신청 승인'
                : isReject
                  ? '신청 반려'
                  : '판정 되돌리기'}
            </h2>
          </AlertDialog.Title>
          {action === 'APPROVE' ? (
            <AlertDialog.Description asChild>
              <p className="break-keep">
                {repositoryConnectionMode === 'OWN'
                  ? '승인하면 신청자가 낸 저장소를 연결합니다. 새 저장소를 만들지 않습니다.'
                  : repositoryProvisioningEnabled
                    ? '승인하면 저장소 자동 생성이 활성화되어 저장소 작업을 시작합니다.'
                    : '승인하면 저장소 자동 생성이 비활성화되어 저장소를 생성하지 않습니다.'}
              </p>
            </AlertDialog.Description>
          ) : isReject ? (
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
                <span
                  id="reason-error"
                  role="alert"
                  className="text-destructive"
                >
                  반려 사유를 입력해 주세요.
                </span>
              ) : null}
              {/*
               * 사유가 학생에게 간다는 사실을 **누르기 전에** 말한다(서류 판정 패널과
               * 같은 규칙). 이 고지가 없으면 교직원은 내부 메모처럼 적는다.
               */}
              <span
                id="reason-hint"
                className="text-muted-foreground break-keep"
              >
                적은 사유는 학생에게 그대로 보입니다.
              </span>
            </div>
          ) : (
            <AlertDialog.Description asChild>
              <p className="break-keep">
                판정을 취소하고 신청을 다시 제출됨 상태로 되돌립니다. 이후
                승인·반려를 다시 할 수 있습니다.
              </p>
            </AlertDialog.Description>
          )}
          {errorMessage !== null ? (
            <Alert variant="destructive">
              <AlertTitle>판정을 저장하지 못했습니다</AlertTitle>
              <AlertDescription className="[word-break:keep-all]">
                {errorMessage}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            {/*
             * ⚠ 저장 중에도 `disabled` 로 막지 않는다 — 창 안의 조작이 전부 disabled 가 되면
             *   포커스를 둘 곳이 없어져 포커스가 창 **밖으로** 새고, 그때부터 읽어 주는 도구는
             *   아무것도 못 읽는다. 실제로 닫는 것은 `onOpenChange` 의 `busy` 가드가 막는다.
             */}
            <AlertDialog.Cancel asChild>
              <Button variant="outline" aria-disabled={busy || undefined}>
                취소
              </Button>
            </AlertDialog.Cancel>
            {/*
             * `AlertDialog.Action`을 쓰지 않는다 — 누르는 순간 창을 닫아 버려서,
             * 저장이 실패했을 때 적어 둔 사유가 함께 사라진다.
             */}
            <Button disabled={busy} onClick={onConfirm}>
              {busy
                ? '처리 중…'
                : action === 'APPROVE'
                  ? '승인 확정'
                  : isReject
                    ? '반려 확정'
                    : '되돌리기 확정'}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
