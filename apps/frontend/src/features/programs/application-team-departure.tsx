'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { leaveMyTeam, type ProgramTeam } from './api';
import { ApplicationActionDialog } from './application-confirmation-dialog';
import { mapTeamError } from './program-teams-flow';

const LAST_MEMBER_REASON =
  '신청 기록이 있는 팀의 마지막 구성원은 팀을 나갈 수 없습니다. 제출한 신청·기록이 가리키는 팀이 남아 있어야 하기 때문입니다.';

const LEADER_SUCCESSION_REASON =
  '팀장이 나가면 남은 팀원 중 가장 먼저 합류한 팀원이 자동으로 팀장이 됩니다. 팀과 다른 팀원의 참여 상태는 그대로 유지됩니다.';

const MEMBER_REASON =
  '본인만 팀에서 나가며, 팀과 다른 팀원의 참여 상태는 그대로 유지됩니다.';

const APPLICATION_KEPT_NOTICE =
  '이미 제출한 신청서와 제출 기록은 삭제되지 않습니다.';

function contextKey(
  programId: string,
  team: ProgramTeam,
  sessionNickname: string,
): string {
  return [programId, team.id, String(team.canLeave), sessionNickname].join('|');
}

export interface ApplicationTeamDepartureProps {
  readonly programId: string;
  readonly team: ProgramTeam;

  readonly sessionNickname: string;
  readonly onDeparted: () => void;
}

export function ApplicationTeamDeparture(props: ApplicationTeamDepartureProps) {
  return (
    <ApplicationTeamDepartureInstance
      key={contextKey(props.programId, props.team, props.sessionNickname)}
      {...props}
    />
  );
}

function ApplicationTeamDepartureInstance({
  programId,
  team,
  onDeparted,
}: ApplicationTeamDepartureProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const deletesTeam = team.isLeader && team.memberCount <= 1;
  const label = deletesTeam ? '팀 삭제' : '팀 탈퇴';
  const explanation = !team.canLeave
    ? LAST_MEMBER_REASON
    : deletesTeam
      ? `팀이 삭제됩니다.${team.canInvite ? ' 이 팀에서 보낸 초대도 함께 취소됩니다.' : ''}`
      : team.isLeader
        ? `${LEADER_SUCCESSION_REASON}${team.canRemoveMembers ? ' 특정 팀원만 내보내려면 팀 구성원 목록의 「팀에서 제외」를 사용해 주세요.' : ''}`
        : MEMBER_REASON;
  const description = team.hasApplication
    ? `${explanation} ${APPLICATION_KEPT_NOTICE}`
    : explanation;

  async function depart() {
    if (pending.current || !team.canLeave) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await leaveMyTeam(programId);

      if (!active.current) return;
      setConfirming(false);
      onDeparted();
    } catch (cause: unknown) {
      if (!active.current) return;
      setError(
        cause instanceof ApiError
          ? mapTeamError(cause.problem)
          : '팀 구성을 변경하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.',
      );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer text-small font-medium">
        팀 관리
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-small text-muted-foreground break-keep">
          {description}
        </p>
        <div className="flex justify-end">
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            disabled={!team.canLeave || busy}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            {label}
          </Button>
        </div>
      </div>
      {confirming ? (
        <ApplicationActionDialog
          title={`${team.name} ${label}`}
          description={description}
          confirmLabel={label}
          destructive
          submitting={busy}
          returnFocusRef={trigger}
          onClose={() => setConfirming(false)}
          onConfirm={() => void depart()}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{label} 실패</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </ApplicationActionDialog>
      ) : null}
    </details>
  );
}
