'use client';

import { useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProgramMailDialog } from './program-mail-dialog';

export function ProgramMailAction({
  programId,
  size = 'sm',
  variant = 'outline',
  className,
}: {
  readonly programId: string;
  readonly size?: 'sm' | 'default';
  readonly variant?: 'outline' | 'default';
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size={size}
        variant={variant}
        className={cn(className)}
        onClick={() => setOpen(true)}
      >
        <Mail aria-hidden="true" />
        메일 보내기
      </Button>
      {open ? (
        <ProgramMailDialog
          key={programId}
          programId={programId}
          open
          returnFocusRef={triggerRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
