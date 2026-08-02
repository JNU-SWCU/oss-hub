'use client';

import { useCallback, useEffect, useState } from 'react';

import { consumeSignupCompletionNotice } from '@/lib/signup-completion-notice';
import { loadStudentDashboard } from '../load-student-dashboard';
import type { StudentDashboard, StudentDashboardStatus } from '../types';
import { StudentDashboardView } from './student-dashboard-view';

export function StudentDashboardScreen() {
  const [data, setData] = useState<StudentDashboard | null>(null);
  const [status, setStatus] = useState<StudentDashboardStatus>('loading');
  const [requestKey, setRequestKey] = useState(0);
  const [signupCompleted, setSignupCompleted] = useState(false);

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
      onRetry={retry}
    />
  );
}
