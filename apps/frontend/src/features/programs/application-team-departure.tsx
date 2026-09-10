'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { leaveMyTeam, type ProgramTeam } from './api';
import { ApplicationActionDialog } from './application-confirmation-dialog';
import { mapTeamError } from './program-teams-flow';

/**
 * 나갈 수 없는 유일한 경우는 「신청 기록이 있는 팀의 마지막 구성원」이다
 * (backend `TEAM_012`). 제출 기록이 가리키는 팀이 사라지지 않도록 팀을 남긴다.
 */
const LAST_MEMBER_REASON =
  '신청 기록이 있는 팀의 마지막 구성원은 팀을 나갈 수 없습니다. 제출한 신청·기록이 가리키는 팀이 남아 있어야 하기 때문입니다.';

/** 팀장이 나가도 팀은 유지된다 — 서버가 남은 팀원 중 가장 먼저 합류한 사람에게 팀장을 넘긴다. */
const LEADER_SUCCESSION_REASON =
  '팀장이 나가면 남은 팀원 중 가장 먼저 합류한 팀원이 자동으로 팀장이 됩니다. 팀과 다른 팀원의 참여 상태는 그대로 유지됩니다.';

const MEMBER_REASON =
  '본인만 팀에서 나가며, 팀과 다른 팀원의 참여 상태는 그대로 유지됩니다.';

const APPLICATION_KEPT_NOTICE =
  '이미 제출한 신청서와 제출 기록은 삭제되지 않습니다.';

/**
 * 이 컴포넌트가 「누구의 어느 팀」을 다루는지. 프로그램·팀·나갈 수 있는지·로그인
 * 계정 중 하나라도 바뀌면 그것은 같은 화면이 아니라 다른 화면이다.
 */
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
  /** 로그인을 확인한 라우트가 넣어 주는 현재 계정. 빈 값으로 대신하지 않는다. */
  readonly sessionNickname: string;
  readonly onDeparted: () => void;
}

/**
 * 팀 관리(접힐 고급 영역)의 나가기·삭제.
 *
 * 무엇을 할 수 있는지는 서버가 계산한 `canLeave`·`canInvite`·`canRemoveMembers`만
 * 따른다. 화면이 팀장 여부나 신청 이력으로 규칙을 다시 유추하지 않는다(ADR-007).
 *
 * 현재 계정(`sessionNickname`)은 이미 로그인을 확인한 라우트가 넣어 준다 — 이
 * 컴포넌트가 다른 feature의 세션 저장소를 직접 읽으면 게이트가 판단한 순간과
 * 화면이 본 순간이 갈리고, 게이트 밖 미리보기에서는 쓸데없는 세션 조회까지 나간다.
 *
 * 신원(`contextKey`)을 key로 쓰는 비공개 구현을 갈아끼운다. 신원이 바뀌는 순간
 * 이전 상태(확인 레이어·진행·오류)와 요청 ref가 통째로 버려지므로, 앞 신원의
 * 답이 다음 신원의 진행·오류를 건드리거나 새 콜백을 부를 수 없다. 호출부가
 * key를 따로 붙일 필요도 없다.
 */
export function ApplicationTeamDeparture(props: ApplicationTeamDepartureProps) {
  return (
    <ApplicationTeamDepartureInstance
      key={contextKey(props.programId, props.team, props.sessionNickname)}
      {...props}
    />
  );
}

/** 신원당 하나씩 사는 실제 구현. 신원 구분은 상위의 key가 이미 끝내 둔다. */
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
    // StrictMode·개발 모드는 effect를 두 번 돌린다 — 다시 붙을 때 살아 있음을
    // 되돌리지 않으면 이 인스턴스가 영원히 응답을 무시하는 상태로 굳는다.
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // 마지막 구성원인 팀장이 나가면 팀 자체가 사라진다 — 그때만 「팀 삭제」다.
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
      // 신원이 바뀌었으면 이 인스턴스는 이미 버려졌다 — 앞 계정의 탈퇴 결과로
      // 지금 사람을 움직이지 않는다.
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
      // 버려진 인스턴스의 ref는 그 인스턴스만의 것이다 — 푸는 순간에도 새 신원의
      // 중복 방지 표식을 대신 풀어 버리지 않는다.
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
