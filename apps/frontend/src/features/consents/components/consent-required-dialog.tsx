'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConsentFlow } from './consent-flow';

export interface ConsentRequiredDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCompleted: () => void;
}

export function ConsentRequiredDialog({
  open,
  onOpenChange,
  onCompleted,
}: ConsentRequiredDialogProps) {
  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) onOpenChange(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-4xl"
        aria-describedby="consent-required-description"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>개인정보·활동 동의가 필요합니다</DialogTitle>
          <DialogDescription id="consent-required-description">
            이 화면을 계속 이용하려면 변경된 필수 동의를 먼저 확인해 주세요.
          </DialogDescription>
        </DialogHeader>
        <div
          data-surface="inverted"
          className="rounded-card bg-cosmos-void p-6"
        >
          <ConsentFlow
            onCompleted={onCompleted}
            policyPresentation="dialog"
            headingPresentation="dialog"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
