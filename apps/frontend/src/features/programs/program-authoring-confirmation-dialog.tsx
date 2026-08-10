import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <AlertDialog.Root
      open
      onOpenChange={(open) => !open && !submitting && onCancel()}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
          <Card className="shadow-xl">
            <CardHeader>
              <AlertDialog.Title asChild>
                <CardTitle>프로그램을 생성하시겠습니까?</CardTitle>
              </AlertDialog.Title>
            </CardHeader>
            <CardContent className="grid gap-5">
              <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                마일스톤, 요구서류, 선택한 양식 파일을 포함한 전체 내용이 한
                번에 생성됩니다.
              </AlertDialog.Description>
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <Button type="button" variant="outline" disabled={submitting}>
                    돌아가서 확인
                  </Button>
                </AlertDialog.Cancel>
                <Button type="button" disabled={submitting} onClick={onConfirm}>
                  {submitting ? '생성 중…' : '생성 확정'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
