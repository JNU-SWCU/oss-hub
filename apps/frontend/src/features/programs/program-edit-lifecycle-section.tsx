import { AlertDialog } from 'radix-ui';
import { SectionHeading } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EditableProgram } from './api';

type ProgramLifecycle = EditableProgram['lifecycle'];

/**
 * 게시 상태 전환은 되돌릴 수 있다 — 공개 노출과 신규 신청만 멈추고 신청·팀·제출
 * 데이터는 그대로 남는다. 그래서 destructive 톤을 쓰지 않는다. 되돌릴 수 없는
 * 행동(삭제)과 같은 색·같은 자리에 두면 두 행동의 무게가 구분되지 않는다.
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
      '공개 목록에서 사라지고 신규 신청이 멈춥니다. 이미 접수된 신청과 팀·제출 데이터는 그대로 남으며 언제든 다시 게시할 수 있습니다.',
    confirm: '내리기',
  },
  ARCHIVED: {
    status: '내림',
    description:
      '현재 프로그램이 내려가 있어 공개 목록에 보이지 않고 신규 신청을 받지 않습니다. 기존 신청과 제출 데이터는 그대로 남아 있습니다.',
    action: '다시 게시하기',
    busyAction: '게시하는 중…',
    dialogTitle: '프로그램을 다시 게시할까요?',
    dialogDescription:
      '공개 목록에 다시 노출되고 신청 기간 안이면 신규 신청을 받습니다.',
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
    <section className="grid gap-6">
      <SectionHeading title="게시 상태" />
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
