'use client';

import { useCallback, useEffect, useState } from 'react';

import { loadStudentDashboard } from '../load-student-dashboard';
import type { StudentDashboard, StudentDashboardStatus } from '../types';
import { StudentDashboardView } from './student-dashboard-view';

export function StudentDashboardScreen() {
  const [data, setData] = useState<StudentDashboard | null>(null);
  const [status, setStatus] = useState<StudentDashboardStatus>('loading');
  const [requestKey, setRequestKey] = useState(0);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

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

  return <StudentDashboardView data={data} status={status} onRetry={retry} />;
}
