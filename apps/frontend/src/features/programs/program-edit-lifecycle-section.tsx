import { AlertDialog } from 'radix-ui';
import { SectionHeading } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EditableProgram } from './api';

type ProgramLifecycle = EditableProgram['lifecycle'];

/**
 * 게시 상태 전환은 되돌릴 수 있다 — 신규 신청만 멈추고 신청·팀·제출 데이터는
 * 그대로 남는다. 그래서 destructive 톤을 쓰지 않는다. 되돌릴 수 없는
 * 행동(삭제)과 같은 색·같은 자리에 두면 두 행동의 무게가 구분되지 않는다.
 *
 * 문구는 실제 동작만 말한다(#1181). 내린 프로그램은 공개 목록에서 사라지지
 * 않는다 — backend `program-list-status-filter.ts` 의 공개 모수가
 * `PUBLISHED | ARCHIVED` 라 목록에 남고, 상세도 열린다
 * (`programs.service.ts` detail 은 lifecycle 로 막지 않는다).
 * 신청이 있는 학생 카드는 `getProgramListBadge` 가 지원 상태를 모집 배지보다
 * 앞에 두므로 「종료」를 약속하지 않는다.
 * 2026-08-04 PR #589 이후의 의도된 동작이므로 문구가 동작을 따라간다.
 *
 * 다시 게시 쪽(#1208)은 재게시가 실제로 여는 하나, 신청 관문만 말한다.
 * `applications.service.ts` 의 `create` 는 두 관문을 이 순서로 통과시킨다 —
 * 먼저 `lifecycle === ARCHIVED` 면 `APP_020` 으로 막고, 그 다음
 * `now < applicationStartAt || now > applicationEndAt` 이면 `APP_010` 으로
 * 막는다. 재게시는 앞 관문만 풀 뿐 뒤 관문은 건드리지 않으므로 신청이 열리는지는
 * 오로지 신청 기간이 정한다. 그래서 세 갈래를 모두 적는다 — 기간 안이면 곧바로,
 * 시작 전이면 시작일에, 이미 끝났으면 열리지 않는다. 마지막 갈래를 빼면
 * 「다시 게시하면 신청이 열린다」로 읽혀 이 티켓이 고치려던 것과 같은 종류의
 * 거짓이 된다.
 *
 * 노출 이야기는 문구에서 뺐다. 내려가 있는 동안에도 목록·상세가 열려 있었으므로
 * 재게시가 바꾸는 노출이 애초에 없다 — 없는 일은 다른 말로 고쳐 적는 대신 그
 * 절을 통째로 뺀다. 모집 배지가 어떻게 파생되는지도 뺐다. 그것을 말하려면 배지
 * 이름을 불러야 하는데 커밋 `0131b9d0` 이 내리기 쪽에서 같은 약속을 이미
 * 걷어냈다(위 `getProgramListBadge` 문단과 같은 이유다).
 *
 * 「언제든 다시 내릴 수 있습니다」는 `program-lifecycle.service.ts` 의 `update`
 * 가 목표 lifecycle 을 받아 현재 값과 다르면 갱신하는 방향 무관한 대칭 토글이라
 * 참이다.
 */
const LIFECYCLE_COPY = {
  PUBLISHED: {
    status: '게시 중',
    description:
      '현재 프로그램이 공개되어 있으며 신청 기간 안이면 신청을 받고 있습니다.',
    action: '프로그램 내리기',
    busyAction: '내리는 중…',
    dialogTitle: '프로그램을 내릴까요?',
    dialogDescription:
      '신규 신청이 곧바로 멈춥니다. 다만 공개 목록에서 사라지지는 않습니다 — 목록과 상세는 그대로 열립니다. 이미 접수된 신청과 팀·제출 데이터는 그대로 남으며 언제든 다시 게시할 수 있습니다.',
    confirm: '내리기',
  },
  ARCHIVED: {
    status: '내림',
    description:
      '현재 프로그램이 내려가 있어 신규 신청을 받지 않습니다. 공개 목록과 상세는 그대로 열립니다. 기존 신청과 제출 데이터는 그대로 남아 있습니다.',
    action: '다시 게시하기',
    busyAction: '게시하는 중…',
    dialogTitle: '프로그램을 다시 게시할까요?',
    dialogDescription:
      '학생 신청은 신청 기간 동안에만 열립니다 — 지금이 기간 안이면 곧바로, 시작 전이면 시작일에, 이미 끝났으면 열리지 않습니다. 언제든 다시 내릴 수 있습니다.',
    confirm: '다시 게시',
  },
} as const satisfies Record<ProgramLifecycle, unknown>;

export function lifecycleStatusLabel(lifecycle: ProgramLifecycle): string {
  return LIFECYCLE_COPY[lifecycle].status;
}

interface ProgramEditLifecycleSectionProps {
  readonly lifecycle: ProgramLifecycle;
  readonly isBusy: boolean;
  readonly isConfirming: boolean;
  /** 게시 상태 전환 실패 메시지. 이 섹션의 버튼 바로 옆에 떠야 한다. */
  readonly error: string | null;
  readonly onRequestToggle: () => void;
  readonly onCancelToggle: () => void;
  readonly onConfirmToggle: () => void;
}

export function ProgramEditLifecycleSection({
  lifecycle,
  isBusy,
  isConfirming,
  error,
  onRequestToggle,
  onCancelToggle,
  onConfirmToggle,
}: ProgramEditLifecycleSectionProps) {
  const copy = LIFECYCLE_COPY[lifecycle];

  return (
    <section className="grid gap-6 rounded-card border border-border bg-card p-card">
      <div className="flex items-center justify-between gap-4">
        <SectionHeading title="게시 상태" />
        <StatusBadge
          variant={lifecycle === 'PUBLISHED' ? 'recruiting' : 'closed'}
        >
          {copy.status}
        </StatusBadge>
      </div>
      <p className="text-body text-muted-foreground [word-break:keep-all]">
        {copy.description}
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={isBusy}
          onClick={onRequestToggle}
        >
          {isBusy ? copy.busyAction : copy.action}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>처리 실패</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {isConfirming ? (
        <AlertDialog.Root
          open
          onOpenChange={(open) => !open && !isBusy && onCancelToggle()}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
            <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
              <Card className="shadow-xl">
                <CardHeader>
                  <AlertDialog.Title asChild>
                    <CardTitle>{copy.dialogTitle}</CardTitle>
                  </AlertDialog.Title>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                    {copy.dialogDescription}
                  </AlertDialog.Description>
                  <div className="flex flex-wrap justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <Button type="button" variant="outline" disabled={isBusy}>
                        취소
                      </Button>
                    </AlertDialog.Cancel>
                    <Button
                      type="button"
                      disabled={isBusy}
                      onClick={onConfirmToggle}
                    >
                      {copy.confirm}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </section>
  );
}
