'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api-client';
import { consumeSignupCompletionNotice } from '@/lib/signup-completion-notice';
import { loadStudentDashboard } from '../load-student-dashboard';
import {
  fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead,
} from '../api';
import {
  acceptTeamInvitation,
  declineTeamInvitation,
  fetchPendingTeamInviteViews,
} from '../team-invitations-api';
import type {
  ApplicationDecisionNotice,
  PendingTeamInviteView,
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';
import { StudentDashboardView } from './student-dashboard-view';

export function StudentDashboardScreen() {
  const router = useRouter();
  const [data, setData] = useState<StudentDashboard | null>(null);
  const [status, setStatus] = useState<StudentDashboardStatus>('loading');
  const [requestKey, setRequestKey] = useState(0);
  const [signupCompleted, setSignupCompleted] = useState(false);
  const [applicationDecisionNotices, setApplicationDecisionNotices] = useState<
    readonly ApplicationDecisionNotice[]
  >([]);
  const [pendingTeamInvites, setPendingTeamInvites] = useState<
    readonly PendingTeamInviteView[]
  >([]);
  const [respondingInvitationId, setRespondingInvitationId] = useState<
    string | null
  >(null);
  const [inviteActionError, setInviteActionError] = useState<string | null>(
    null,
  );

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  // 표시 읽기는 mount 뒤 한 번뿐이다. 서버 렌더에는 sessionStorage가 없어 렌더
  // 도중에 읽으면 서버와 클라이언트가 다른 화면을 그려 hydration이 깨진다.
  // 참으로 올릴 때만 setState 한다 — 개발 모드의 StrictMode 이중 실행에서 두 번째
  // 실행은 이미 지워진 표시를 보게 되는데, 그때 거짓으로 되돌리면 배너가 사라진다.
  useEffect(() => {
    if (consumeSignupCompletionNotice()) {
      setSignupCompleted(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchUnreadApplicationDecisionNotices()
      .then((notices) => {
        if (!active) return;
        setApplicationDecisionNotices(notices);
      })
      .catch(() => {
        // 부가 알림 실패가 대시보드 본문까지 막아서는 안 된다.
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * 받은 초대 목록을 다시 읽는다. 조회가 실패하면 **직전 목록을 그대로 둔다** —
   * 일시적인 네트워크 실패로 배너가 통째로 사라지면 방금 본 초대가 없어진 것처럼
   * 보인다. 첫 진입에서는 초기값이 빈 배열이라 섹션이 조용히 접히는 것과 같다.
   */
  const reloadPendingInvites = useCallback(async () => {
    try {
      setPendingTeamInvites(await fetchPendingTeamInviteViews());
    } catch {
      // 받은 팀 초대 조회 실패가 대시보드 본문까지 막아서는 안 된다.
    }
  }, []);

  useEffect(() => {
    void reloadPendingInvites();
  }, [reloadPendingInvites]);

  /**
   * 수락한 뒤에는 **그 팀 화면으로 보낸다.**
   *
   * 배너에서 항목만 사라지면 수락한 사람 입장에서는 아무 일도 안 일어난 것처럼
   * 보인다 — 「내가 지금 이 팀에 들어간 게 맞나」를 확인할 자리가 화면에 없다.
   * `/programs/{id}/teams` 는 팀 구성원과 초대 현황을 보여 주는 자리라 합류가
   * 눈으로 확인된다. 이동하면 대시보드는 돌아올 때 다시 읽으므로 여기서 따로
   * 갱신하지 않아도 방금 합류한 프로그램 카드가 보인다.
   *
   * ⚠ 목적지는 응답이 아니라 **화면이 이미 들고 있는 초대 항목**에서 얻는다.
   * 수락 응답에도 `teamId`·`programId` 가 있지만 이 화면의 API 모듈은 그 본문을
   * 읽지 않고 있어(`acceptTeamInvitation` 이 `void`), 계약을 넓히지 않고 지금
   * 가진 값을 쓴다.
   */
  const handleAcceptInvite = useCallback(
    (invitationId: string) => {
      const accepted = pendingTeamInvites.find(
        (item) => item.invitationId === invitationId,
      );
      setRespondingInvitationId(invitationId);
      setInviteActionError(null);
      void acceptTeamInvitation(invitationId)
        .then(() => {
          setPendingTeamInvites((items) =>
            items.filter((item) => item.invitationId !== invitationId),
          );
          if (accepted) {
            router.push(
              `/programs/${encodeURIComponent(accepted.programId)}/teams`,
            );
          }
        })
        .catch((error: unknown) => {
          setInviteActionError(
            error instanceof ApiError
              ? error.problem.detail
              : '초대 수락에 실패했습니다.',
          );
          // 실패는 대개 그 사이에 초대가 닫힌 것이다(취소·중복 수락·정원 초과).
          // 목록을 다시 읽지 않으면 이미 죽은 초대가 배너에 남아, 눌러도 같은
          // 오류만 반복된다.
          void reloadPendingInvites();
        })
        .finally(() => setRespondingInvitationId(null));
    },
    [pendingTeamInvites, reloadPendingInvites, router],
  );

  // 거절은 이동하지 않는다 — 목록에서 사라지는 것이 곧 결과다. 실패했을 때
  // 목록을 다시 읽는 이유는 수락과 같다(이미 닫힌 초대가 남지 않게).
  const handleDeclineInvite = useCallback(
    (invitationId: string) => {
      setRespondingInvitationId(invitationId);
      setInviteActionError(null);
      void declineTeamInvitation(invitationId)
        .then(() => {
          setPendingTeamInvites((items) =>
            items.filter((item) => item.invitationId !== invitationId),
          );
        })
        .catch((error: unknown) => {
          setInviteActionError(
            error instanceof ApiError
              ? error.problem.detail
              : '초대 거절에 실패했습니다.',
          );
          void reloadPendingInvites();
        })
        .finally(() => setRespondingInvitationId(null));
    },
    [reloadPendingInvites],
  );

  useEffect(() => {
    if (applicationDecisionNotices.length === 0) return;
    // 이 effect는 배너가 DOM에 커밋된 뒤에만 돈다. 조회 Promise 안에서 곧바로
    // 읽음 처리하면 렌더 전에 이동·오류가 생겼을 때 보지 못한 알림을 잃는다.
    // 실패하면 다음 방문에서 다시 보여 주므로 네트워크 단절도 알림을 삼키지 않는다.
    void Promise.allSettled(
      applicationDecisionNotices.map((notice) =>
        markApplicationDecisionNoticeRead(notice.id),
      ),
    );
  }, [applicationDecisionNotices]);

  useEffect(() => {
    let active = true;
    setData(null);
    setStatus('loading');

    void loadStudentDashboard().then((result) => {
      if (!active) return;
      if (result.status === 'success') {
        setData(result.data);
        setStatus('success');
        return;
      }
      setStatus('error');
    });

    return () => {
      active = false;
    };
  }, [requestKey]);

  return (
    <StudentDashboardView
      data={data}
      status={status}
      showSignupCompleteNotice={signupCompleted}
      applicationDecisionNotices={applicationDecisionNotices}
      pendingTeamInvites={pendingTeamInvites}
      respondingInvitationId={respondingInvitationId}
      inviteActionError={inviteActionError}
      onAcceptInvite={handleAcceptInvite}
      onDeclineInvite={handleDeclineInvite}
      onRetry={retry}
    />
  );
}
