'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { UserMinus, UserPlus, X } from 'lucide-react';
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
import { removeMyTeamMember, type ProgramTeam, type TeamMember } from './api';
import { ApplicationActionDialog } from './application-confirmation-dialog';
import { mapTeamError } from './program-teams-flow';
import type { TeamInvitationManagement } from './use-team-invitation-management';
import type { SentTeamInvitation } from './team-invitation-api';

const REMOVE_LABEL = '팀에서 제외';
const INVITE_LABEL = '팀원 초대';
const PENDING_LABEL = '초대 대기';
const CANCEL_INVITE_LABEL = '초대 취소';

const REMOVAL_SCOPE_NOTICE =
  '팀 구성원 목록에서만 빠집니다. 이미 제출한 신청서와 제출 기록은 그대로 남고, 계정과 다른 프로그램 참여에는 영향이 없습니다.';

function displayNameOf(member: TeamMember): string {
  return member.name?.trim() || member.nickname;
}

function inviteeNameOf(invitation: SentTeamInvitation): string {
  return invitation.invitee.name?.trim() || invitation.invitee.nickname;
}

function orderedRoster(members: readonly TeamMember[]): readonly TeamMember[] {
  return [...members].sort(
    (left, right) => Number(right.isLeader) - Number(left.isLeader),
  );
}

function contextKey(
  programId: string,
  team: ProgramTeam | null,
  sessionNickname: string,
  mode: TeamMembersPanelMode,
): string {
  return [
    programId,
    team === null ? 'no-team' : team.id,
    team === null ? 'no-capability' : String(team.canRemoveMembers),
    sessionNickname,
    mode,
  ].join('|');
}

export type TeamMembersPanelMode = 'compose' | 'manage';

export interface TeamMembersPanelProps {
  readonly programId: string;

  readonly team: ProgramTeam | null;

  readonly sessionNickname: string;
  readonly mode: TeamMembersPanelMode;

  readonly invitation: TeamInvitationManagement | null;

  readonly onOpenInvite: (() => void) | null;
  readonly inviteTriggerRef: RefObject<HTMLButtonElement | null> | null;
  readonly onChanged: () => void;
}

export function TeamMembersPanel(props: TeamMembersPanelProps) {
  return (
    <TeamMembersPanelInstance
      key={contextKey(
        props.programId,
        props.team,
        props.sessionNickname,
        props.mode,
      )}
      {...props}
    />
  );
}

function TeamMembersPanelInstance({
  programId,
  team,
  sessionNickname,
  mode,
  invitation,
  onOpenInvite,
  inviteTriggerRef,
  onChanged,
}: TeamMembersPanelProps) {
  const [target, setTarget] = useState<TeamMember | null>(null);
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

  const invitingUserId = invitation?.invitingUserId ?? null;
  useEffect(() => {
    if (invitingUserId !== null) setCancelTargetId(null);
  }, [invitingUserId]);

  const roster = team === null ? [] : orderedRoster(team.members);
  const memberIds = new Set(roster.map((member) => member.userId));

  const pendingInvitations = (invitation?.sentInvitations ?? []).filter(
    (item) => item.status === 'PENDING' && !memberIds.has(item.invitee.id),
  );

  const inviteActionError = invitation?.inviteActionError ?? null;
  const retryCancelId =
    inviteActionError !== null &&
    cancelTargetId !== null &&
    invitation?.cancelingInvitationId === null &&
    pendingInvitations.some((item) => item.id === cancelTargetId)
      ? cancelTargetId
      : null;

  const canInvite =
    onOpenInvite !== null &&
    inviteTriggerRef !== null &&
    (team ? team.canInvite : true);
  const capacity = team === null ? null : `팀원 ${team.memberCount}명`;
  const sizeRule =
    team === null
      ? null
      : team.minMembers !== null && team.maxMembers > 0
        ? `최소 ${team.minMembers}명 · 최대 ${team.maxMembers}명`
        : team.minMembers !== null
          ? `최소 ${team.minMembers}명`
          : null;

  function canRemove(member: TeamMember): boolean {
    if (mode !== 'manage') return false;
    if (team === null || !team.canRemoveMembers) return false;
    if (member.isLeader) return false;
    return member.nickname !== sessionNickname;
  }

  async function remove(member: TeamMember) {
    if (pending.current || !canRemove(member)) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await removeMyTeamMember(programId, member.userId);

      if (!active.current) return;
      setTarget(null);
      onChanged();
    } catch (cause: unknown) {
      if (!active.current) return;
      setError(
        cause instanceof ApiError
          ? mapTeamError(cause.problem)
          : '팀원을 제외하지 못했습니다. 현재 팀 상태를 확인한 뒤 다시 시도해 주세요.',
      );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Card size="sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>
              <h2 className="contents">팀 구성원</h2>
            </CardTitle>
            {team === null ? null : (
              <CardDescription>
                {`${team.name} · ${capacity}${sizeRule ? ` · ${sizeRule}` : ''}`}
              </CardDescription>
            )}
          </div>
          {canInvite ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={inviteTriggerRef ?? undefined}
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={INVITE_LABEL}
                  aria-haspopup="dialog"
                  onClick={() => onOpenInvite?.()}
                >
                  <UserPlus aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{INVITE_LABEL}</TooltipContent>
            </Tooltip>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {invitation?.sentError ? (
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
                    onClick={() =>
                      invitation?.onCancelInvitation(retryCancelId)
                    }
                  >
                    다시 시도
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {invitation?.sentLoading ? (
            <p className="text-small text-muted-foreground" aria-live="polite">
              보낸 초대를 불러오는 중…
            </p>
          ) : null}

          <ListPanel>
            <ul
              aria-label="팀 구성원과 초대"
              className="[&>li+li]:border-t [&>li+li]:border-border/50"
            >
              {team === null ? (
                <li>
                  <ListRow>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="whitespace-nowrap rounded-control border border-border px-2 text-small text-muted-foreground">
                        팀장 예정
                      </span>
                      <span className="max-w-full break-all font-mono">
                        {sessionNickname}
                      </span>
                    </span>
                  </ListRow>
                </li>
              ) : (
                roster.map((member) => {
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
                        {canRemove(member) ? (
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
                                  setTarget(member);
                                }}
                              >
                                <UserMinus aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{`${displayName} ${REMOVE_LABEL}`}</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </ListRow>
                    </li>
                  );
                })
              )}
              {pendingInvitations.map((item) => {
                const name = inviteeNameOf(item);
                const canceling = invitation?.cancelingInvitationId === item.id;
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
                              invitation?.onCancelInvitation(item.id);
                            }}
                          >
                            <X aria-hidden="true" />
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
            title={`${displayNameOf(target)} 팀원을 제외하시겠습니까?`}
            description={`${displayNameOf(target)} 팀원이 ${REMOVAL_SCOPE_NOTICE}`}
            confirmLabel={REMOVE_LABEL}
            destructive
            submitting={busy}
            returnFocusRef={trigger}
            onClose={() => setTarget(null)}
            onConfirm={() => void remove(target)}
          >
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{REMOVE_LABEL} 실패</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </ApplicationActionDialog>
        ) : null}
      </Card>
    </TooltipProvider>
  );
}
