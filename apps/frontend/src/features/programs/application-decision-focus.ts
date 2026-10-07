'use client';

import { useCallback, useEffect, useState } from 'react';
import { applicationDecisionTriggerId } from './application-presentation';
import type { ApplicationDecisionAction } from './types';

export function applicationDecisionFocusOrder(
  action: ApplicationDecisionAction,
  applicationId?: string,
): readonly string[] {
  const candidates: readonly ApplicationDecisionAction[] = [
    action,
    'REVERT',
    'APPROVE',
    'REJECT',
  ];
  return [
    ...Array.from(new Set(candidates)).map((candidate) =>
      applicationDecisionTriggerId(candidate, applicationId),
    ),
    `${applicationDecisionTriggerId('REVERT', applicationId)}-reason`,
  ];
}

export function focusApplicationDecisionTrigger(
  ids: readonly string[],
): boolean {
  for (const id of ids) {
    const candidate = document.getElementById(id);
    if (!(candidate instanceof HTMLElement)) continue;
    candidate.focus();
    if (document.activeElement === candidate) return true;
  }
  return false;
}

function focusIsUnclaimed(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

export function useApplicationDecisionFocusReturn(): (
  action: ApplicationDecisionAction,
  applicationId?: string,
) => void {
  const [pending, setPending] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (pending === null) return;
    if (!focusIsUnclaimed()) return;
    focusApplicationDecisionTrigger(pending);
  }, [pending]);

  return useCallback(
    (action: ApplicationDecisionAction, applicationId?: string): void => {
      setPending(applicationDecisionFocusOrder(action, applicationId));
    },
    [],
  );
}
