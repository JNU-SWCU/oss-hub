'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Clock, Ellipsis } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListRow } from '@/components/list-panel';
import { ApiError } from '@/lib/api-client';
import { ApplicationActionDialog } from '../applications/application-confirmation-dialog';
import { mapTeamError } from './program-teams-flow';
import {
  removeStaffTeamMember,
  transferStaffTeamLeader,
} from './staff-team-members-api';
import type { TeamActivity } from './team-activity-dto';
import { TeamInvitePanel } from './team-invite-panel';
import type { StaffProgramTeamMember } from './dto';
import {
  useTeamInvitationManagement,
  type TeamInvitationManagement,
} from './use-team-invitation-management';

const REMOVE_LABEL = '팀에서 제외';
const TRANSFER_LABEL = '팀장 변경';
const INVITE_LABEL = '팀원 초대';
const PENDING_LABEL = '초대 대기';
const CANCEL_INVITE_LABEL = '초대 취소';

const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 3_600_000;

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

type RosterPerson = Pick<StaffProgramTeamMember, 'name' | 'nickname'>;

function displayNameOf(person: RosterPerson): string {
  return person.name?.trim() || person.nickname;
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

function recentCommitsByUser(activity: TeamActivity | undefined, now: number) {
  const commits = new Map<string, number>();
  if (activity?.status !== 'COLLECTED') return commits;

  const today = Math.floor((now + SEOUL_OFFSET_MS) / DAY_MS);
  const start = (today - 13) * DAY_MS;
  const end = (today + 1) * DAY_MS;
  for (const member of activity.members) {
    let count = 0;
    for (const point of member.points) {
      const day = Date.parse(point.date);
      if (day >= start && day < end) count += point.commitCount;
    }
    if (count > 0) commits.set(member.userId, count);
  }
  return commits;
}

function RosterRow({
  person,
  disabled,
  actions,
  focusAfterSelect,
  children,
}: {
  readonly person: RosterPerson;
  readonly disabled: boolean;
  readonly actions: readonly {
    readonly label: string;
    readonly onSelect: (trigger: HTMLButtonElement | null) => void;
  }[];
  readonly focusAfterSelect?: RefObject<HTMLButtonElement | null>;
  readonly children?: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const selected = useRef(false);
  const name = displayNameOf(person);
  const { nickname } = person;

  return (
    <li>
      <ListRow className="min-h-control flex-nowrap gap-2 px-(--card-spacing) py-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="max-w-full font-semibold break-keep [overflow-wrap:anywhere]">
            {name === nickname ? `@${nickname}` : name}
          </span>
          {name !== nickname ? (
            <span className="max-w-full text-small break-all text-muted-foreground">
              @{nickname}
            </span>
          ) : null}
          {children}
        </span>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild disabled={disabled}>
            <Button
              ref={trigger}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${name} 작업`}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              collisionPadding={8}
              className="z-50 min-w-40 rounded-control border border-border bg-background p-1 text-small text-foreground shadow-lg outline-none"
              onCloseAutoFocus={(event) => {
                if (!selected.current) return;
                selected.current = false;

                event.preventDefault();
                focusAfterSelect?.current?.focus();
              }}
            >
              {actions.map((action) => (
                <DropdownMenu.Item
                  key={action.label}
                  className="flex min-h-control cursor-pointer items-center rounded-control px-3 outline-none data-[highlighted]:bg-muted"
                  onSelect={() => {
                    selected.current = true;
                    action.onSelect(trigger.current);
                  }}
                >
                  {action.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </ListRow>
    </li>
  );
}

export interface StaffTeamMembersPanelProps {
  readonly programId: string;
  readonly teamId: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
  readonly activity?: TeamActivity;

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
  memberCount,
  members,
  activity,
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
        memberCount={memberCount}
        members={members}
        activity={activity}
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
  memberCount,
  members,
  activity,
  invitation,
  inviteTriggerRef,
  onOpenInvite,
  onChanged,
}: {
  readonly programId: string;
  readonly teamId: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
  readonly activity?: TeamActivity;
  readonly invitation: TeamInvitationManagement;
  readonly inviteTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly onOpenInvite: () => void;
  readonly onChanged: () => void;
}) {
  const [target, setTarget] = useState<ConfirmTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const titleId = useId();
  const rowTrigger = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef: RefObject<HTMLButtonElement | null> = {
    get current() {
      const trigger = rowTrigger.current;
      return trigger?.isConnected ? trigger : inviteTriggerRef.current;
    },
  };
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
  const commitsByUser = recentCommitsByUser(activity, Date.now());
  const memberIds = new Set(roster.map((member) => member.userId));
  const pendingInvitations = invitation.sentInvitations.filter(
    (item) => !memberIds.has(item.invitee.id),
  );
  const inviteActionError = invitation.inviteActionError;
  const retryCancelId =
    inviteActionError !== null &&
    cancelTargetId !== null &&
    invitation.cancelingInvitationId === null &&
    pendingInvitations.some((item) => item.id === cancelTargetId)
      ? cancelTargetId
      : null;

  function openConfirmation(
    target: ConfirmTarget,
    trigger: HTMLButtonElement | null,
  ) {
    rowTrigger.current = trigger;
    setError(null);
    setTarget(target);
  }

  async function runMutation({ kind, member }: ConfirmTarget): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'remove') {
        await removeStaffTeamMember(programId, teamId, member.userId);
      } else {
        await transferStaffTeamLeader(programId, teamId, member.userId);
      }
      if (!active.current) return;
      if (kind === 'remove') rowTrigger.current = null;
      setTarget(null);
      onChanged();
    } catch (cause: unknown) {
      if (!active.current) return;
      setError(
        mutationErrorMessage(
          cause,
          kind === 'remove' ? REMOVE_FAILED_MESSAGE : TRANSFER_FAILED_MESSAGE,
        ),
      );
      onChanged();
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
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
    <>
      <Card role="region" aria-labelledby={titleId}>
        <CardHeader className="flex items-start justify-between gap-3">
          <CardTitle className="flex flex-wrap items-baseline gap-x-1 text-sm">
            <h2 id={titleId}>팀원</h2>
            <span className="text-small font-normal text-muted-foreground">
              {memberCount}명
            </span>
          </CardTitle>
          <Button
            ref={inviteTriggerRef}
            type="button"
            variant="outline"
            size="sm"
            aria-haspopup="dialog"
            onClick={onOpenInvite}
          >
            {INVITE_LABEL}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          {invitation.sentError ? (
            <Alert variant="destructive" className="mx-(--card-spacing)">
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
            <Alert variant="destructive" className="mx-(--card-spacing)">
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
            <p
              className="mx-(--card-spacing) text-small text-muted-foreground"
              aria-live="polite"
            >
              보낸 초대를 불러오는 중…
            </p>
          ) : null}
          <ul
            aria-label="팀 구성원과 초대"
            className="[&>li+li]:border-t [&>li+li]:border-border/50"
          >
            {roster.map((member) => {
              const commits = commitsByUser.get(member.userId);
              const remove = {
                label: REMOVE_LABEL,
                onSelect: (trigger: HTMLButtonElement | null) =>
                  openConfirmation({ kind: 'remove', member }, trigger),
              };
              const transfer = {
                label: TRANSFER_LABEL,
                onSelect: (trigger: HTMLButtonElement | null) =>
                  openConfirmation({ kind: 'transfer', member }, trigger),
              };
              return (
                <RosterRow
                  key={`member-${member.userId}`}
                  person={member}
                  disabled={busy}
                  actions={member.isLeader ? [remove] : [transfer, remove]}
                >
                  {member.isLeader ? (
                    <span className="text-small text-muted-foreground">
                      팀장
                    </span>
                  ) : null}
                  {commits !== undefined ? (
                    <span className="text-small break-keep text-muted-foreground tabular-nums">
                      최근 2주 커밋 {commits}
                    </span>
                  ) : null}
                </RosterRow>
              );
            })}
            {pendingInvitations.map((item) => (
              <RosterRow
                key={`invite-${item.id}`}
                person={item.invitee}
                disabled={invitation.cancelingInvitationId === item.id}
                focusAfterSelect={inviteTriggerRef}
                actions={[
                  {
                    label: CANCEL_INVITE_LABEL,
                    onSelect: () => {
                      setCancelTargetId(item.id);
                      invitation.onCancelInvitation(item.id);
                    },
                  },
                ]}
              >
                <span className="inline-flex items-center gap-1 text-small whitespace-nowrap text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden="true" />
                  {PENDING_LABEL}
                </span>
              </RosterRow>
            ))}
          </ul>
        </CardContent>
      </Card>
      {target ? (
        <ApplicationActionDialog
          title={confirmTitle}
          description={confirmDescription}
          confirmLabel={confirmLabel}
          destructive={target.kind === 'remove'}
          submitting={busy}
          returnFocusRef={returnFocusRef}
          onClose={() => setTarget(null)}
          onConfirm={() => void runMutation(target)}
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
                  onClick={() => void runMutation(target)}
                >
                  다시 시도
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </ApplicationActionDialog>
      ) : null}
    </>
  );
}
