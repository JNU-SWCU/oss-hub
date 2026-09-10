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

/**
 * 제외가 실제로 지우는 범위. 확인 레이어와 목록 안내가 같은 문장을 쓴다 —
 * 학생이 "계정이 지워지나?"를 다이얼로그에서 되묻지 않아야 한다.
 */
const REMOVAL_SCOPE_NOTICE =
  '팀 구성원 목록에서만 빠집니다. 이미 제출한 신청서와 제출 기록은 그대로 남고, 계정과 다른 프로그램 참여에는 영향이 없습니다.';

function displayNameOf(member: TeamMember): string {
  return member.name?.trim() || member.nickname;
}

function inviteeNameOf(invitation: SentTeamInvitation): string {
  return invitation.invitee.name?.trim() || invitation.invitee.nickname;
}

/** 팀장 먼저, 그 외에는 백엔드가 준 순서 그대로(정렬은 안정적이다). */
function orderedRoster(members: readonly TeamMember[]): readonly TeamMember[] {
  return [...members].sort(
    (left, right) => Number(right.isLeader) - Number(left.isLeader),
  );
}

/**
 * 이 패널이 「누구의 어느 팀」을 다루는지. 프로그램·팀·팀장 권한·로그인 계정·
 * 화면 모드 중 하나라도 바뀌면 그것은 같은 화면이 아니라 다른 화면이다.
 * 아직 팀이 없는 자리는 `team === null`이며, 지어낸 팀 id 대신 그 사실을 그대로 쓴다.
 */
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

/**
 * `compose`는 아직 신청서를 보내기 전의 팀 구성 화면이다 — 제외라는 개념 자체가
 * 없으므로 제외 조작은 아예 그려지지 않는다. `manage`는 「우리 팀」처럼 이미
 * 만들어진 팀을 운영하는 화면이다.
 */
export type TeamMembersPanelMode = 'compose' | 'manage';

export interface TeamMembersPanelProps {
  readonly programId: string;
  /** 아직 팀이 만들어지지 않았으면 `null` — 가짜 팀을 지어내지 않는다. */
  readonly team: ProgramTeam | null;
  /** 로그인을 확인한 라우트가 넣어 주는 현재 계정. 빈 값으로 대신하지 않는다. */
  readonly sessionNickname: string;
  readonly mode: TeamMembersPanelMode;
  /**
   * 초대 상태. 팀이 없어 아직 보낸 초대를 읽을 수 없는 자리는 `null`이고,
   * 그때도 초대 시작(+)은 살아 있다 — 팀을 만드는 일은 호출부가 맡는다.
   */
  readonly invitation: TeamInvitationManagement | null;
  /**
   * 초대 진입점이 있는 화면만 준다. 이미 제출한 신청서를 보는 자리처럼 초대가
   * 이 화면의 일이 아닌 표면은 `null`을 주고, 그때는 서버가 `canInvite`를 주더라도
   * 「+」를 그리지 않는다 — 아무 일도 하지 않는 버튼을 놓아 두지 않는다.
   */
  readonly onOpenInvite: (() => void) | null;
  readonly inviteTriggerRef: RefObject<HTMLButtonElement | null> | null;
  readonly onChanged: () => void;
}

/**
 * 신청 화면과 우리 팀 화면이 함께 쓰는 팀 구성원 목록.
 *
 * 「팀에서 제외」를 보일지는 서버가 계산한 `team.canRemoveMembers`와 화면 모드만
 * 따른다. 팀장 여부·신청 이력으로 화면이 같은 규칙을 다시 유추하지 않는다(ADR-007).
 *
 * 현재 계정은 로그인을 이미 확인한 라우트가 `sessionNickname`으로 넣어 준다.
 * 이 패널은 다른 feature의 세션 저장소를 직접 읽지 않으며, 그 때문에 미리보기처럼
 * 세션이 없는 자리에서도 예상치 못한 인증 조회를 만들지 않는다.
 *
 * 신원(`contextKey`)을 key로 쓰는 비공개 구현을 갈아끼운다. 신원이 바뀌는 순간
 * 이전 상태(제외 대상·진행·오류)와 요청 ref가 React에 의해 통째로 버려지므로,
 * 렌더 중 상태를 되돌리는 편법 없이도 앞 신원의 답이 다음 신원을 건드릴 수 없다.
 * 이 경계를 호출부 key에 맡기지 않는다 — 호출부마다 빠뜨리거나 중복해 왔다.
 */
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

/** 신원당 하나씩 사는 실제 구현. */
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
  /**
   * 이 목록에서 마지막으로 취소를 건 초대. 실패 안내를 「어느 초대의 취소가
   * 실패했는가」로 말하고, 다시 시도를 같은 취소 조작으로 잇기 위해서만 쓴다.
   */
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    // StrictMode·개발 모드는 effect를 두 번 돌린다 — 다시 붙을 때 살아 있음을
    // 되돌리지 않으면 이 인스턴스가 영원히 응답을 무시하는 상태로 굳는다.
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // 초대 보내기가 새로 시작되면 다음 실패는 취소의 것이 아니다 — 앞 취소의
  // 표식을 남겨 두면 초대 실패를 취소 실패로 잘못 말하게 된다.
  const invitingUserId = invitation?.invitingUserId ?? null;
  useEffect(() => {
    if (invitingUserId !== null) setCancelTargetId(null);
  }, [invitingUserId]);

  const roster = team === null ? [] : orderedRoster(team.members);
  const memberIds = new Set(roster.map((member) => member.userId));
  /**
   * 초대는 아직 팀원이 아니다 — 같은 목록에 이어 붙이되 인원수
   * (`memberCount`)와는 절대 섞지 않는다.
   *
   * 팀과 보낸 초대는 서로 다른 조회라 잠시 엇갈릴 수 있다 — 이미 합류한
   * 사람이 대기 중으로 한 번 더 보이는 순간을 만들지 않는다.
   */
  const pendingInvitations = (invitation?.sentInvitations ?? []).filter(
    (item) => item.status === 'PENDING' && !memberIds.has(item.invitee.id),
  );
  /**
   * 팀이 없는 자리는 「내가 만들 팀」이라 초대 시작이 열려 있고, 초대 진입점을
   * 받지 못한 표면은 권한과 무관하게 닫혀 있다.
   */
  /**
   * 취소는 목록 안의 X가 시작하는데, 그 실패 문구는 초대 레이어에만 있었다 —
   * 레이어가 닫힌 「우리 팀」 화면에서는 실패가 통째로 사라졌다. 훅이 준 오류를
   * 그대로 목록에 그리고, 방금 건 취소가 아직 대기 중이면 같은 취소를 다시 건다.
   */
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

  /**
   * 팀장이 다른 팀원만 제외할 수 있다. 본인 행에는 어떤 경우에도 붙지 않고,
   * 신청 전 구성(`compose`) 화면에는 제외라는 조작 자체가 없다.
   */
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
      // 신원이 바뀌었으면 이 인스턴스는 이미 버려졌다 — 그 때의 답으로
      // 새 화면을 갱신하거나 새 콜백을 부를 수 없다.
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
      // 버려진 인스턴스의 ref는 그 인스턴스만의 것이다 — 푸는 순간에도 새 신원의
      // 중복 방지 표식을 대신 풀어 버리지 않는다.
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
              {/* 카드 제목 스타일은 그대로 두고 heading 의미만 h2로 준다. */}
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
          {/*
            팀원과 대기 중인 초대는 한 목록이다 — 「누가 지금 이 팀에 관계되어 있는가」를
            두 번 읽게 하지 않는다. 구분은 행 안의 「초대 대기」 표시가 맡고,
            인원수는 서버가 준 `memberCount`만 그대로 말한다.
          */}
          <ListPanel>
            {/*
              줄 사이 구분선. `ListRow`의 인접 선택자는 행끼리 형제일 때만 닿는데
              여기서는 각 행이 `li`로 감싸여 있어, 같은 토큰을 목록 항목 사이에 준다.
            */}
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
