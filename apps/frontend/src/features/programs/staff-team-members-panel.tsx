'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { UserMinus, UserPlus, UserRoundPen, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ListPanel, ListRow } from '@/components/list-panel';
import { ApiError } from '@/lib/api-client';
import { ApplicationActionDialog } from './application-confirmation-dialog';
import { mapTeamError } from './program-teams-flow';
import {
  removeStaffTeamMember,
  transferStaffTeamLeader,
} from './staff-team-members-api';
import type { SentTeamInvitation } from './team-invitation-api';
import { TeamInvitePanel } from './team-invite-panel';
import type { StaffProgramTeamMember } from './types';
import {
  useTeamInvitationManagement,
  type TeamInvitationManagement,
} from './use-team-invitation-management';

const REMOVE_LABEL = '팀에서 제외';
const TRANSFER_LABEL = '팀장 변경';
const INVITE_LABEL = '팀원 초대';
const PENDING_LABEL = '초대 대기';
const CANCEL_INVITE_LABEL = '초대 취소';

const REMOVE_FAILED_MESSAGE =
  '팀원을 제외하지 못했습니다. 현재 팀 상태를 확인한 뒤 다시 시도해 주세요.';
const TRANSFER_FAILED_MESSAGE =
  '팀장을 바꾸지 못했습니다. 현재 팀 상태를 확인한 뒤 다시 시도해 주세요.';

const REMOVAL_SCOPE_NOTICE =
  '팀 구성원 목록에서만 빠집니다. 이미 제출한 신청서와 제출 기록은 그대로 남고, 계정과 다른 프로그램 참여에는 영향이 없습니다.';

const TRANSFER_SCOPE_NOTICE =
  '이 팀의 팀장만 바뀝니다. 구성원 명단과 신청서, 계정은 그대로 남습니다.';

type ConfirmTarget =
  | { readonly kind: 'remove'; readonly member: StaffProgramTeamMember }
  | { readonly kind: 'transfer'; readonly member: StaffProgramTeamMember };

function displayNameOf(member: StaffProgramTeamMember): string {
  return member.name?.trim() || member.nickname;
}

function inviteeNameOf(invitation: SentTeamInvitation): string {
  return invitation.invitee.name?.trim() || invitation.invitee.nickname;
}

function orderedRoster(
  members: readonly StaffProgramTeamMember[],
): readonly StaffProgramTeamMember[] {
  return [...members].sort(
    (left, right) => Number(right.isLeader) - Number(left.isLeader),
  );
}

function contextKey(
  programId: string,
  teamId: string,
  sessionKey: string,
): string {
  return [programId, teamId, sessionKey].join('|');
}

function mutationErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? mapTeamError(cause.problem) : fallback;
}

export interface StaffTeamMembersPanelProps {
  readonly programId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];

  readonly sessionKey: string | null;
  readonly onChanged: () => void;
}

export function StaffTeamMembersPanel(props: StaffTeamMembersPanelProps) {
  return (
    <StaffTeamMembersPanelInstance
      key={contextKey(
        props.programId,
        props.teamId,
        props.sessionKey ?? 'no-session',
      )}
      {...props}
    />
  );
}

function StaffTeamMembersPanelInstance({
  programId,
  teamId,
  teamName,
  memberCount,
  members,
  sessionKey,
  onChanged,
}: StaffTeamMembersPanelProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const invitation = useTeamInvitationManagement({
    programId,
    team: { id: teamId, canInvite: true },
    sessionKey,
  });

  return (
    <>
      <StaffTeamMembersRoster
        programId={programId}
        teamId={teamId}
        teamName={teamName}
        memberCount={memberCount}
        members={members}
        invitation={invitation}
        inviteTriggerRef={inviteTriggerRef}
        onOpenInvite={() => setInviteOpen(true)}
        onChanged={onChanged}
      />
      <TeamInvitePanel
        invitation={invitation}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        returnFocusRef={inviteTriggerRef}
      />
    </>
  );
}

function StaffTeamMembersRoster({
  programId,
  teamId,
  teamName,
  memberCount,
  members,
  invitation,
  inviteTriggerRef,
  onOpenInvite,
  onChanged,
}: {
  readonly programId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
  readonly invitation: TeamInvitationManagement;
  readonly inviteTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly onOpenInvite: () => void;
  readonly onChanged: () => void;
}) {
  const [target, setTarget] = useState<ConfirmTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const invitingUserId = invitation.invitingUserId;
  useEffect(() => {
    if (invitingUserId !== null) setCancelTargetId(null);
  }, [invitingUserId]);

  const roster = orderedRoster(members);
  const memberIds = new Set(roster.map((member) => member.userId));
  const pendingInvitations = invitation.sentInvitations.filter(
    (item) => item.status === 'PENDING' && !memberIds.has(item.invitee.id),
  );
  const inviteActionError = invitation.inviteActionError;
  const retryCancelId =
    inviteActionError !== null &&
    cancelTargetId !== null &&
    invitation.cancelingInvitationId === null &&
    pendingInvitations.some((item) => item.id === cancelTargetId)
      ? cancelTargetId
      : null;

  async function runMutation(
    work: () => Promise<void>,
    fallback: string,
  ): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
      if (!active.current) return;
      setTarget(null);
      onChanged();
    } catch (cause: unknown) {
      if (!active.current) return;
      setError(mutationErrorMessage(cause, fallback));
      onChanged();
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function remove(member: StaffProgramTeamMember): Promise<void> {
    await runMutation(
      () => removeStaffTeamMember(programId, teamId, member.userId),
      REMOVE_FAILED_MESSAGE,
    );
  }

  async function transfer(member: StaffProgramTeamMember): Promise<void> {
    await runMutation(
      () => transferStaffTeamLeader(programId, teamId, member.userId),
      TRANSFER_FAILED_MESSAGE,
    );
  }

  const confirmTitle =
    target === null
      ? ''
      : target.kind === 'remove'
        ? `${displayNameOf(target.member)} 팀원을 제외하시겠습니까?`
        : `${displayNameOf(target.member)} 님을 팀장으로 바꾸시겠습니까?`;
  const confirmDescription =
    target === null
      ? ''
      : target.kind === 'remove'
        ? `${displayNameOf(target.member)} 팀원이 ${REMOVAL_SCOPE_NOTICE}`
        : `${displayNameOf(target.member)} 님에게 ${TRANSFER_SCOPE_NOTICE}`;
  const confirmLabel =
    target === null
      ? ''
      : target.kind === 'remove'
        ? REMOVE_LABEL
        : TRANSFER_LABEL;
  const confirmFailedTitle =
    target?.kind === 'transfer'
      ? `${TRANSFER_LABEL} 실패`
      : `${REMOVE_LABEL} 실패`;

  return (
    <TooltipProvider delayDuration={200}>
      <Card size="sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>
              <h2 className="contents">구성원 관리</h2>
            </CardTitle>
            <CardDescription>{`${teamName} · 팀원 ${memberCount}명`}</CardDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={inviteTriggerRef}
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={INVITE_LABEL}
                aria-haspopup="dialog"
                onClick={onOpenInvite}
              >
                <UserPlus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{INVITE_LABEL}</TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {invitation.sentError ? (
            <Alert variant="destructive">
              <AlertTitle>보낸 초대를 불러오지 못했습니다</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span className="break-keep">{invitation.sentError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={invitation.onRetrySent}
                >
                  다시 시도
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {inviteActionError ? (
            <Alert variant="destructive">
              <AlertTitle>
                {retryCancelId !== null
                  ? `${CANCEL_INVITE_LABEL} 실패`
                  : '초대 요청에 실패했습니다'}
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span className="break-keep">{inviteActionError}</span>
                {retryCancelId !== null ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => invitation.onCancelInvitation(retryCancelId)}
                  >
                    다시 시도
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {invitation.sentLoading ? (
            <p className="text-small text-muted-foreground" aria-live="polite">
              보낸 초대를 불러오는 중…
            </p>
          ) : null}
          <ListPanel>
            <ul
              aria-label="팀 구성원과 초대"
              className="[&>li+li]:border-t [&>li+li]:border-border/50"
            >
              {roster.map((member) => {
                const displayName = displayNameOf(member);
                const showNickname = displayName !== member.nickname;
                return (
                  <li key={member.userId}>
                    <ListRow className="justify-between">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="whitespace-nowrap rounded-control border border-border px-2 text-small text-muted-foreground">
                          {member.isLeader ? '팀장' : '팀원'}
                        </span>
                        {displayName}
                        {showNickname ? (
                          <span className="max-w-full break-all font-mono text-small text-muted-foreground">
                            {member.nickname}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {member.isLeader ? null : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${displayName} ${TRANSFER_LABEL}`}
                                disabled={busy}
                                onClick={(event) => {
                                  trigger.current = event.currentTarget;
                                  setError(null);
                                  setTarget({ kind: 'transfer', member });
                                }}
                              >
                                <UserRoundPen aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{`${displayName} ${TRANSFER_LABEL}`}</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${displayName} ${REMOVE_LABEL}`}
                              disabled={busy}
                              onClick={(event) => {
                                trigger.current = event.currentTarget;
                                setError(null);
                                setTarget({ kind: 'remove', member });
                              }}
                            >
                              <UserMinus aria-hidden="true" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{`${displayName} ${REMOVE_LABEL}`}</TooltipContent>
                        </Tooltip>
                      </span>
                    </ListRow>
                  </li>
                );
              })}
              {pendingInvitations.map((item) => {
                const name = inviteeNameOf(item);
                const canceling = invitation.cancelingInvitationId === item.id;
                return (
                  <li key={item.id}>
                    <ListRow className="justify-between">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="whitespace-nowrap rounded-control border border-dashed border-border px-2 text-small text-muted-foreground">
                          {PENDING_LABEL}
                        </span>
                        {name}
                        {name !== item.invitee.nickname ? (
                          <span className="max-w-full break-all font-mono text-small text-muted-foreground">
                            {item.invitee.nickname}
                          </span>
                        ) : null}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${name} ${CANCEL_INVITE_LABEL}`}
                            disabled={canceling}
                            onClick={() => {
                              setCancelTargetId(item.id);
                              invitation.onCancelInvitation(item.id);
                            }}
                          >
                            <UserMinus aria-hidden="true" className="hidden" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{`${name} ${CANCEL_INVITE_LABEL}`}</TooltipContent>
                      </Tooltip>
                    </ListRow>
                  </li>
                );
              })}
            </ul>
          </ListPanel>
        </CardContent>
        {target ? (
          <ApplicationActionDialog
            title={confirmTitle}
            description={confirmDescription}
            confirmLabel={confirmLabel}
            destructive={target.kind === 'remove'}
            submitting={busy}
            returnFocusRef={trigger}
            onClose={() => setTarget(null)}
            onConfirm={() =>
              void (target.kind === 'remove'
                ? remove(target.member)
                : transfer(target.member))
            }
          >
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{confirmFailedTitle}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span className="break-keep">{error}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void (target.kind === 'remove'
                        ? remove(target.member)
                        : transfer(target.member))
                    }
                  >
                    다시 시도
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
          </ApplicationActionDialog>
        ) : null}
      </Card>
    </TooltipProvider>
  );
}
