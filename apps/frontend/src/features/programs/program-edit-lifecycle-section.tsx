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
 * 다시 게시 쪽도 같은 이유로 「다시 노출」을 약속하지 않는다(#1208). 내려가 있는
 * 동안에도 목록·상세는 열려 있었으므로 새로 생기는 노출이 없다. 실제로 바뀌는
 * 것은 두 가지다 — 모집 상태가 `ARCHIVED → ended` 로 고정돼 있던 것이 풀려
 * 날짜 파생으로 돌아가고(`program-list.ts` `getProgramRecruitmentState` 와
 * backend `deriveProgramListStatus` 의 첫 분기가 같은 우선순위다), 신규 신청이
 * lifecycle 거절(`applications.service.ts` 의 APP_020)에서 벗어나 신청 기간
 * 검사만 받는다. 종료일이 이미 지난 프로그램은 다시 게시해도 여전히 종료로
 * 파생되므로 「모집중이 된다」가 아니라 「기간에 따라 다시 정해진다」고 말한다.
 * 바뀐 뒤 카드에 어떤 배지가 뜨는지는 위와 같은 이유로 약속하지 않는다.
 *
 * 조건절은 「신청 기간 안이면」이라야 한다. 「신청 기간이 남아 있으면」은 아직
 * 시작하지 않은 신청 기간(upcoming)까지 포함해 읽히는데, 그 프로그램은 다시
 * 게시해도 `applicationStartAt` 이 올 때까지 `now < applicationStartAt` 로 계속
 * 막히므로 「곧바로 열린다」가 거짓이 된다. 고치려던 것과 같은 종류의 약속이다.
 * 모집 상태가 묶여 있던 이유는 게시 축의 「내림」이고 모집 축의 값이 아니다 —
 * 「내림에 고정돼 있던 모집 상태」라고 쓰면 두 축을 한 단어로 겹쳐 부른다.
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
      '신청 기간 안이면 신규 신청이 곧바로 다시 열리고, 내려 둔 동안 고정돼 있던 모집 상태도 풀려 신청·운영 기간에 따라 다시 정해집니다. 다만 공개 목록에 새로 노출되지는 않습니다 — 내려가 있는 동안에도 목록과 상세는 그대로 열려 있었습니다. 언제든 다시 내릴 수 있습니다.',
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
