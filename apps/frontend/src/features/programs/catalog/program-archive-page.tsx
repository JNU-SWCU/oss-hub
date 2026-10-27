'use client';

import { useEffect, useState } from 'react';
import { FailureState } from '@/components';
import { getProgramEndedYears } from './api';
import { ProgramListPage } from './program-list-page';

export function ProgramArchivePage() {
  const [years, setYears] = useState<readonly number[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    getProgramEndedYears(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setYears(loaded);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {failed ? (
        <FailureState
          title="아카이브 연도를 불러오지 못했습니다"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      ) : (
        <ProgramListPage
          canCreateProgram={false}
          viewerRole={null}
          archiveYears={years}
        />
      )}
    </main>
  );
}
