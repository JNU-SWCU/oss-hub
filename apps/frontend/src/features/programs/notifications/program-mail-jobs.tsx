'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FailureState } from '@/components';
import { Button } from '@/components/ui/button';
import { getMailJob, getMailJobs } from './program-mail-api';
import { ProgramMailResult } from './program-mail-compose';

export function ProgramMailJobs({
  programId,
  onSelect,
}: {
  programId: string;
  onSelect: (jobId: string) => void;
}) {
  const list = useInfiniteQuery({
    queryKey: ['program-mail-jobs', programId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getMailJobs(programId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: 'always',
    gcTime: 0,
  });
  if (list.isError)
    return (
      <FailureState
        title="발송 기록을 불러오지 못했습니다"
        onRetry={() => void list.refetch()}
      />
    );
  if (!list.data) return <p role="status">발송 기록을 불러오는 중입니다.</p>;
  const receipts = list.data.pages.flatMap((page) => page.items);
  return (
    <section aria-label="발송 기록">
      {receipts.length === 0 && <p>발송 기록이 없습니다.</p>}
      <ul>
        {receipts.map(({ jobId, acceptedAt }) => (
          <li key={jobId}>
            <Button
              type="button"
              value={jobId}
              variant="link"
              onClick={() => onSelect(jobId)}
            >
              <time dateTime={acceptedAt}>
                {new Date(acceptedAt).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                })}
              </time>
            </Button>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={list.isFetching}
          onClick={() => void list.fetchNextPage()}
        >
          이전 기록
        </Button>
      )}
    </section>
  );
}

export function ProgramMailJobStatus({
  programId,
  jobId,
}: {
  programId: string;
  jobId: string;
}) {
  const job = useQuery({
    queryKey: ['program-mail-job', programId, jobId],
    queryFn: ({ signal }) => getMailJob(programId, jobId, signal),
    retry: false,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) =>
      state.error || state.data?.status === 'COMPLETED'
        ? false
        : Math.min(10000, 2000 * Math.max(1, state.dataUpdateCount)),
  });
  if (job.isError)
    return (
      <FailureState
        title="발송 결과를 불러오지 못했습니다"
        onRetry={() => void job.refetch()}
      />
    );
  if (!job.data) return <p role="status">발송 결과를 불러오는 중입니다.</p>;
  if (
    job.data.status === 'COMPLETED' &&
    job.data.source?.startsWith('DEADLINE_')
  )
    return (
      <section aria-label="발송 결과">
        {(job.data.audiences ?? []).map((row) => (
          <section
            key={row.audience}
            aria-label={row.audience === 'STAFF' ? '교직원' : '학생'}
          >
            <h3>{row.audience === 'STAFF' ? '교직원' : '학생'}</h3>
            <ProgramMailResult result={{ ...row, status: 'COMPLETED' }} />
            <p>
              취소{' '}
              <data data-outcome="cancelledCount" value={row.cancelledCount}>
                {row.cancelledCount}
              </data>
              명
            </p>
          </section>
        ))}
      </section>
    );
  return job.data.status === 'COMPLETED' ? (
    <ProgramMailResult result={job.data} />
  ) : (
    <p role="status">메일 발송을 처리 중입니다.</p>
  );
}
