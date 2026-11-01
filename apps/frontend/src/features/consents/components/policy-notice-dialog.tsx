'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const storageKey = (policyVersion: string): string =>
  `policy-notice-seen:${policyVersion}`;

export interface PolicyNoticeDialogProps {
  readonly policyVersion: string;
}

export function PolicyNoticeDialog({ policyVersion }: PolicyNoticeDialogProps) {
  const [open, setOpen] = useState(
    () => window.localStorage.getItem(storageKey(policyVersion)) === null,
  );

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) return;
    window.localStorage.setItem(storageKey(policyVersion), 'seen');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="policy-notice">
        <DialogHeader>
          <DialogTitle>활동 수집 안내가 바뀌었습니다</DialogTitle>
          <DialogDescription>
            로그인할 때 본인 권한으로 올해 비공개 저장소 기여 건수를 집계해 랭킹
            합계에 더합니다. 집계에 쓴 GitHub 인증 정보는 바로 파기합니다.
          </DialogDescription>
        </DialogHeader>
        <a
          href="/policies/github-activity"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline underline-offset-4"
        >
          변경된 안내 읽기 (새 창)
        </a>
        <DialogFooter>
          <Button type="button" onClick={() => handleOpenChange(false)}>
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
