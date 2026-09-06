import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSeoulDate } from './program-detail-format';

/**
 * 마감 뒤 보완 요청에 응하는 **되돌릴 수 없는 제출**을 확인받는 창.
 *
 * 어휘는 이 저장소에 이미 있는 되돌릴 수 없는 행동들에서 그대로 가져온다 — 프로그램 생성
 * (`ProgramAuthoringConfirmationDialog`)·프로그램 내리기(`ProgramEditLifecycleSection`)·서류
 * 항목 삭제(`milestone-document-row.tsx`)가 쓰는 말이다.
 * - 껍데기: `AlertDialog`(`Dialog`가 아니다 — 되돌릴 수 없는 결정이라 docs/design.md의
 *   피드백 표에서 `dialog` 행이 `role="alertdialog"`를 요구한다) + `Card` 안에 제목·본문·버튼.
 * - 「되돌릴 수 없습니다」 — 서류 항목 삭제 확인 문구 그대로.
 * - 「돌아가서 확인」 — 프로그램 생성 확인의 취소 버튼 그대로. 그냥 「취소」보다 **무엇을
 *   할 수 있는지**를 말한다.
 * - 「제출 확정」 — 「생성 확정」·「삭제 확정」과 같은 짜임.
 *
 * 색은 만들지 않는다. 확인 버튼은 기본(주조색) `Button`이다 — `destructive`를 쓰지 않는 것은
 * 게시 상태 전환이 그것을 쓰지 않는 것과 같은 이유다: **파괴가 아니라 확정**이고, 삭제와 같은
 * 색·같은 무게로 그리면 두 행동의 차이가 사라진다.
 */
export function MilestoneDocumentResubmissionDialog({
  documentName,
  resubmissionDueAt,
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
  readonly submitting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => !open && !submitting && onCancel()}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <AlertDialog.Content
          data-testid="milestone-document-resubmission-dialog"
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none"
        >
          <Card className="shadow-xl">
            <CardHeader>
              <AlertDialog.Title asChild>
                <CardTitle>제출하면 더 이상 바꿀 수 없습니다</CardTitle>
              </AlertDialog.Title>
            </CardHeader>
            <CardContent className="grid gap-5">
              <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                {documentName} 제출 항목을 보완 요청에 응해 다시 제출합니다.
                보낸 뒤에는 담당 교직원의 검토가 끝날 때까지 내용을 바꿀 수
                없습니다. 되돌릴 수 없습니다.
                {resubmissionDueAt === null
                  ? ''
                  : ` 재제출 기한(${formatSeoulDate(resubmissionDueAt)})이 남아 있어도 마찬가지입니다.`}
              </AlertDialog.Description>
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <Button type="button" variant="outline" disabled={submitting}>
                    돌아가서 확인
                  </Button>
                </AlertDialog.Cancel>
                <Button type="button" disabled={submitting} onClick={onConfirm}>
                  {submitting ? '제출하는 중…' : '제출 확정'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
