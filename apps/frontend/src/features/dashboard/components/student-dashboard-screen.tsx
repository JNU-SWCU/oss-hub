'use client';

import { useCallback, useEffect, useState } from 'react';

import { consumeSignupCompletionNotice } from '@/lib/signup-completion-notice';
import { loadStudentDashboard } from '../load-student-dashboard';
import {
  fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead,
} from '../api';
import type {
  ApplicationDecisionNotice,
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';
import { StudentDashboardView } from './student-dashboard-view';

export function StudentDashboardScreen() {
  const [data, setData] = useState<StudentDashboard | null>(null);
  const [status, setStatus] = useState<StudentDashboardStatus>('loading');
  const [requestKey, setRequestKey] = useState(0);
  const [signupCompleted, setSignupCompleted] = useState(false);
  const [applicationDecisionNotices, setApplicationDecisionNotices] = useState<
    readonly ApplicationDecisionNotice[]
  >([]);

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
      onRetry={retry}
    />
  );
}
