import { useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function RepositoryUrlCancelButton({
  dirty,
  disabled,
  onDiscard,
}: {
  readonly dirty: boolean;
  readonly disabled: boolean;
  readonly onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && !dirty) onDiscard();
        else setOpen(nextOpen);
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          취소
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
          <Card className="shadow-xl">
            <CardHeader>
              <AlertDialog.Title asChild>
                <CardTitle>변경사항을 저장하지 않고 돌아가겠습니까?</CardTitle>
              </AlertDialog.Title>
            </CardHeader>
            <CardContent className="grid gap-5">
              <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                수정한 저장소 URL과 변경 사유가 저장되지 않습니다.
              </AlertDialog.Description>
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialog.Action asChild>
                  <Button type="button" variant="outline" onClick={onDiscard}>
                    변경사항 버리기
                  </Button>
                </AlertDialog.Action>
                <AlertDialog.Cancel asChild>
                  <Button type="button">이어서 수정하기</Button>
                </AlertDialog.Cancel>
              </div>
            </CardContent>
          </Card>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
