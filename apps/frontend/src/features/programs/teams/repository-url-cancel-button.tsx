'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && !dirty) onDiscard();
        else setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="취소"
          title="취소"
          disabled={disabled}
        >
          <X aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogPortal>
        <AlertDialogOverlay />
        <AlertDialogContent>
          <Card className="shadow-xl">
            <CardHeader>
              <AlertDialogTitle asChild>
                <CardTitle>변경사항을 저장하지 않고 돌아가겠습니까?</CardTitle>
              </AlertDialogTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <AlertDialogDescription className="text-body text-muted-foreground [word-break:keep-all]">
                수정한 저장소 URL이 저장되지 않습니다.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialogCancel asChild>
                  <Button type="button" variant="outline">
                    이어서 수정하기
                  </Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={onDiscard}
                  >
                    변경사항 버리기
                  </Button>
                </AlertDialogAction>
              </div>
            </CardContent>
          </Card>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialog>
  );
}
