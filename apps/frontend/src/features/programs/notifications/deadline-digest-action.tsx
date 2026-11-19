'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { programFeatureKey } from '@/lib/query-keys';
import { getEditableProgram } from '../authoring/api';
import { DeadlineDigestDialog } from './deadline-digest-dialog';

type DeadlineDigestActionProps = {
  readonly programId: string;
  readonly enabled?: boolean;
  readonly size?: 'sm' | 'default';
  readonly className?: string;
};

export function DeadlineDigestAction(props: DeadlineDigestActionProps) {
  return props.enabled === undefined ? (
    <QueriedDeadlineDigestAction {...props} />
  ) : (
    <ResolvedDeadlineDigestAction {...props} enabled={props.enabled} />
  );
}

function QueriedDeadlineDigestAction(
  props: Omit<DeadlineDigestActionProps, 'enabled'>,
) {
  const settingsQuery = useQuery({
    queryKey: programFeatureKey(props.programId, 'edit'),
    queryFn: () => getEditableProgram(props.programId),
    staleTime: 0,
  });
  if (settingsQuery.isError)
    return (
      <p className="text-small text-muted-foreground">
        마감 알림 설정을 불러오지 못했습니다.
      </p>
    );
  if (settingsQuery.data === undefined)
    return (
      <Button
        type="button"
        size={props.size ?? 'sm'}
        variant="outline"
        className={cn(props.className)}
        disabled
        aria-busy="true"
      >
        <BellRing aria-hidden="true" />
        마감 알림 보내기
      </Button>
    );
  return (
    <ResolvedDeadlineDigestAction
      {...props}
      enabled={settingsQuery.data.notifyOnDeadline}
    />
  );
}

function ResolvedDeadlineDigestAction({
  programId,
  enabled,
  size = 'sm',
  className,
}: Omit<DeadlineDigestActionProps, 'enabled'> & { readonly enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    if (open) {
      openedRef.current = true;
      return;
    }
    if (!openedRef.current) return;
    openedRef.current = false;
    triggerRef.current?.focus();
  }, [open]);

  if (!enabled)
    return (
      <p className="text-small text-muted-foreground">
        제출 마감 알림을 켜야 합니다.
      </p>
    );

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size={size}
        variant="outline"
        className={cn(className)}
        onClick={() => setOpen(true)}
      >
        <BellRing aria-hidden="true" />
        마감 알림 보내기
      </Button>
      {open ? (
        <DeadlineDigestDialog
          programId={programId}
          returnFocusRef={triggerRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
