'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchStudentDashboard } from '../api';
import type {
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';
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

    fetchStudentDashboard()
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setStatus('success');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [requestKey]);

  return (
    <StudentDashboardView
      data={data}
      status={status}
      onRetry={retry}
    />
  );
}
