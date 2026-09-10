'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { programMyTeamHref, programOverviewHref } from '@/lib/program-route';
import { cn } from '@/lib/utils';
import {
  acceptInvitation,
  declineInvitation,
  listReceivedInvitations,
  type ReceivedTeamInvitation,
} from './team-invitation-api';
import { notifyTeamMembershipChanged } from './team-membership-events';

const POLL_INTERVAL_MS = 60_000;

export interface TeamInvitationNotificationsProps {
  /** 계정이 바뀌었을 때 이전 계정의 목록과 응답을 버리기 위한 식별자. */
  readonly identityKey?: string | null;
  readonly className?: string;
}

type InvitationLoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly items: readonly ReceivedTeamInvitation[];
      readonly refreshError: string | null;
    }
  | { readonly kind: 'error'; readonly message: string };

type InvitationAction = 'accept' | 'decline';
type InvitationActionState =
  | { readonly kind: InvitationAction; readonly status: 'pending' }
  | {
      readonly kind: InvitationAction;
      readonly status: 'error';
      readonly message: string;
    };

type ActionStates = Readonly<Record<string, InvitationActionState>>;
type LoadMode = 'replace' | 'refresh';

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.problem.detail.trim().length > 0) {
    return error.problem.detail;
  }
  return fallback;
}

function errorMessage(error: unknown): string {
  return actionErrorMessage(error, '받은 팀 초대를 불러오지 못했습니다.');
}

function invitationErrorId(invitationId: string): string {
  return `team-invitation-error-${encodeURIComponent(invitationId)}`;
}

export function TeamInvitationNotifications({
  identityKey = null,
  className,
}: TeamInvitationNotificationsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<InvitationLoadState>({
    kind: 'loading',
  });
  const [actionStates, setActionStates] = useState<ActionStates>({});
  const mountedRef = useRef(false);
  const identityRef = useRef(identityKey);
  const requestGenerationRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const actionInFlightRef = useRef(new Set<string>());
  const pollTimerRef = useRef<number | null>(null);

  const isCurrentIdentity = useCallback(() => {
    return mountedRef.current && identityRef.current === identityKey;
  }, [identityKey]);

  const invalidatePendingList = useCallback(() => {
    requestGenerationRef.current += 1;
    requestInFlightRef.current = false;
  }, []);

  const loadInvitations = useCallback(
    async (mode: LoadMode = 'replace') => {
      if (requestInFlightRef.current) return;

      const requestGeneration = requestGenerationRef.current + 1;
      requestGenerationRef.current = requestGeneration;
      const requestIdentity = identityKey;
      requestInFlightRef.current = true;
      if (mountedRef.current && mode === 'replace') {
        setLoadState({ kind: 'loading' });
      }

      try {
        const invitations = await listReceivedInvitations();
        if (
          !mountedRef.current ||
          requestGeneration !== requestGenerationRef.current ||
          requestIdentity !== identityRef.current
        ) {
          return;
        }
        setLoadState({
          kind: 'ready',
          items: invitations.filter(
            (invitation) => invitation.status === 'PENDING',
          ),
          refreshError: null,
        });
      } catch (error: unknown) {
        if (
          !mountedRef.current ||
          requestGeneration !== requestGenerationRef.current ||
          requestIdentity !== identityRef.current
        ) {
          return;
        }
        const message = errorMessage(error);
        setLoadState((current) => {
          if (mode === 'refresh' && current.kind === 'ready') {
            return { ...current, refreshError: message };
          }
          return { kind: 'error', message };
        });
      } finally {
        if (requestGeneration === requestGenerationRef.current) {
          requestInFlightRef.current = false;
        }
      }
    },
    [identityKey],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      actionInFlightRef.current.clear();
    };
  }, []);

  useEffect(() => {
    identityRef.current = identityKey;
    requestGenerationRef.current += 1;
    requestInFlightRef.current = false;
    actionInFlightRef.current.clear();
    setOpen(false);
    setLoadState({ kind: 'loading' });
    setActionStates({});
  }, [identityKey]);

  useEffect(() => {
    void loadInvitations('replace');
  }, [loadInvitations]);

  useEffect(() => {
    const refreshOnFocus = () => {
      void loadInvitations('refresh');
    };
    const stopPolling = () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    const startPolling = () => {
      if (pollTimerRef.current !== null) return;
      pollTimerRef.current = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void loadInvitations('refresh');
      }, POLL_INTERVAL_MS);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadInvitations('refresh');
        startPolling();
        return;
      }
      stopPolling();
    };

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    if (document.visibilityState === 'visible') {
      startPolling();
    }

    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      stopPolling();
    };
  }, [loadInvitations]);

  const respondToInvitation = useCallback(
    async (invitation: ReceivedTeamInvitation, action: InvitationAction) => {
      if (actionInFlightRef.current.has(invitation.id)) return;
      actionInFlightRef.current.add(invitation.id);
      setActionStates((current) => ({
        ...current,
        [invitation.id]: { kind: action, status: 'pending' },
      }));

      try {
        const accepted =
          action === 'accept' ? await acceptInvitation(invitation.id) : null;
        if (action === 'decline') {
          await declineInvitation(invitation.id);
        }

        if (!isCurrentIdentity()) return;
        invalidatePendingList();
        setLoadState((current) => {
          if (current.kind !== 'ready') return current;
          return {
            kind: 'ready',
            items: current.items.filter((item) => item.id !== invitation.id),
            refreshError: null,
          };
        });
        setActionStates((current) => {
          const next = { ...current };
          delete next[invitation.id];
          return next;
        });
        if (accepted) {
          // 같은 URL에 이미 있는 「우리 팀」 화면은 router.refresh()로 다시 읽지 않는다.
          notifyTeamMembershipChanged(accepted.programId);
          router.push(programMyTeamHref(accepted.programId));
          router.refresh();
        }
      } catch (error: unknown) {
        if (!isCurrentIdentity()) return;
        setActionStates((current) => ({
          ...current,
          [invitation.id]: {
            kind: action,
            status: 'error',
            message: actionErrorMessage(
              error,
              action === 'accept'
                ? '팀 초대 수락에 실패했습니다.'
                : '팀 초대 거절에 실패했습니다.',
            ),
          },
        }));
      } finally {
        actionInFlightRef.current.delete(invitation.id);
      }
    },
    [invalidatePendingList, isCurrentIdentity, router],
  );

  const pendingCount = loadState.kind === 'ready' ? loadState.items.length : 0;
  const displayedCount = pendingCount > 99 ? '99+' : String(pendingCount);
  const items = loadState.kind === 'ready' ? loadState.items : [];
  const refreshError =
    loadState.kind === 'ready' ? loadState.refreshError : null;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        void loadInvitations('refresh');
      }
    },
    [loadInvitations],
  );

  return (
    <div
      data-slot="team-invitation-notifications"
      className={cn('relative flex items-center', className)}
    >
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="팀 초대 알림"
            aria-haspopup="dialog"
            aria-expanded={open}
            onFocus={() => {
              if (!open) void loadInvitations('refresh');
            }}
          >
            <Bell aria-hidden="true" />
            {pendingCount > 0 ? (
              <span
                data-slot="team-invitation-count"
                aria-label={`대기 중인 팀 초대 ${pendingCount}건`}
                className={cn(
                  'absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center',
                  'rounded-full bg-destructive px-1 text-xs font-semibold',
                  'text-destructive-foreground',
                )}
              >
                {displayedCount}
              </span>
            ) : null}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            aria-labelledby="team-invitation-notifications-title"
            className={cn(
              'z-50 w-[min(24rem,calc(100vw-2rem))] rounded-card border border-border',
              'bg-background p-4 text-foreground shadow-lg outline-none',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="team-invitation-notifications-title"
                  className="font-heading text-base font-semibold"
                >
                  팀 초대
                </h2>
              </div>
              <Popover.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="팀 초대 알림 닫기"
                >
                  <X aria-hidden="true" />
                </Button>
              </Popover.Close>
            </div>

            <div
              className="mt-4"
              aria-busy={loadState.kind === 'loading'}
              data-slot="team-invitation-notifications-state"
            >
              {loadState.kind === 'loading' ? (
                <div
                  role="status"
                  aria-live="polite"
                  className={cn(
                    'flex items-center gap-2 py-6 text-small',
                    'text-muted-foreground',
                  )}
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none"
                  />
                  <span>팀 초대를 불러오는 중입니다.</span>
                </div>
              ) : null}

              {loadState.kind === 'error' ? (
                <div
                  role="alert"
                  className={cn(
                    'flex flex-col gap-3 rounded-control border border-destructive/40',
                    'bg-destructive/5 p-3 text-small',
                  )}
                >
                  <p>{loadState.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void loadInvitations('replace');
                    }}
                  >
                    <RefreshCw aria-hidden="true" />
                    다시 시도
                  </Button>
                </div>
              ) : null}

              {refreshError ? (
                <div
                  role="alert"
                  className={cn(
                    'mb-3 flex flex-col gap-3 rounded-control',
                    'border border-destructive/40 bg-destructive/5 p-3 text-small',
                  )}
                >
                  <p>{refreshError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void loadInvitations('refresh');
                    }}
                  >
                    <RefreshCw aria-hidden="true" />
                    다시 시도
                  </Button>
                </div>
              ) : null}

              {loadState.kind === 'ready' && items.length === 0 ? (
                <p className="py-6 text-center text-small text-muted-foreground">
                  새로운 팀 초대가 없습니다.
                </p>
              ) : null}

              {loadState.kind === 'ready' && items.length > 0 ? (
                <ul className="flex max-h-[min(28rem,60vh)] flex-col gap-3 overflow-y-auto">
                  {items.map((invitation) => {
                    const actionState = actionStates[invitation.id];
                    const responding = actionState?.status === 'pending';
                    const errorId = invitationErrorId(invitation.id);
                    const teamLabel = invitation.teamName || '이름 없는 팀';
                    return (
                      <li
                        key={invitation.id}
                        data-slot="team-invitation-item"
                        data-invitation-id={invitation.id}
                        aria-busy={responding}
                        className="rounded-control border border-border p-3"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold">{teamLabel}</p>
                          <p className="mt-1 text-small text-muted-foreground">
                            {/* 수락 전에는 팀 화면이 없으므로 프로그램 개요만 연다. */}
                            <Link
                              href={programOverviewHref(invitation.programId)}
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              {invitation.programName}
                            </Link>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {invitation.invitedByDisplayName}님이 초대했습니다 ·{' '}
                            {invitation.memberCount}/{invitation.teamMaxSize}명
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={responding}
                            aria-label={`${teamLabel} 팀 초대 수락`}
                            aria-describedby={
                              actionState?.status === 'error'
                                ? errorId
                                : undefined
                            }
                            onClick={() => {
                              void respondToInvitation(invitation, 'accept');
                            }}
                          >
                            {responding && actionState.kind === 'accept'
                              ? '처리 중…'
                              : '수락'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={responding}
                            aria-label={`${teamLabel} 팀 초대 거절`}
                            aria-describedby={
                              actionState?.status === 'error'
                                ? errorId
                                : undefined
                            }
                            onClick={() => {
                              void respondToInvitation(invitation, 'decline');
                            }}
                          >
                            {responding && actionState.kind === 'decline'
                              ? '처리 중…'
                              : '거절'}
                          </Button>
                        </div>
                        {actionState?.status === 'error' ? (
                          <p
                            id={errorId}
                            role="alert"
                            className="mt-2 text-small text-destructive"
                          >
                            {actionState.message}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
