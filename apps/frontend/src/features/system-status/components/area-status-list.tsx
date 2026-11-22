import { Fragment, useId, type ReactNode } from 'react';
import { ListPanel, ListRow, SectionHeading, StatusBadge } from '@/components';
import { formatRelativeTime, formatStamp } from '../system-status-format';
import type { CollectionHealth, SystemStatus } from '../types';

const HEALTH = {
  EMPTY: { label: '추적 대상 없음', variant: 'closed' },
  NORMAL: { label: '정상', variant: 'approved' },
  DELAYED: { label: '지연', variant: 'pending' },
} as const satisfies Record<
  CollectionHealth,
  { label: string; variant: 'approved' | 'pending' | 'closed' }
>;

const NO_RECORD = '기록 없음';

type Stat = readonly [label: string, value: ReactNode];

function count(value: number, unit = ''): string {
  return `${value.toLocaleString('ko-KR')}${unit}`;
}

function AreaRow({
  name,
  badges,
  stats,
}: {
  readonly name: string;
  readonly badges: ReactNode;
  readonly stats: readonly Stat[];
}) {
  return (
    <ListRow>
      <h3 className="w-26 shrink-0 font-semibold">{name}</h3>
      {badges}
      <p className="min-w-0 flex-1 basis-64 text-small text-muted-foreground tabular-nums">
        {stats.map(([label, value], index) => (
          <Fragment key={label}>
            {index > 0 ? ' · ' : null}
            <span className="whitespace-nowrap">
              {label} <b className="font-semibold text-foreground">{value}</b>
            </span>
          </Fragment>
        ))}
      </p>
    </ListRow>
  );
}

export function AreaStatusList({ status }: { readonly status: SystemStatus }) {
  const headingId = useId();
  const { collection, provisioning, mail, externalCollection } = status;
  const health = HEALTH[collection.health];
  const now = new Date();

  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <SectionHeading id={headingId} title="구역 현황" />
      <ListPanel>
        <AreaRow
          name="저장소 발급"
          badges={
            provisioning.failedFinal > 0 ? (
              <StatusBadge variant="rejected">실패</StatusBadge>
            ) : (
              <StatusBadge variant="approved">정상</StatusBadge>
            )
          }
          stats={[
            ['대기 중', count(provisioning.pending)],
            ['생성 중', count(provisioning.processing)],
            ['재시도 대기', count(provisioning.retryable)],
            ['생성 실패', count(provisioning.failedFinal)],
          ]}
        />
        <AreaRow
          name="활동 수집"
          badges={
            <>
              <StatusBadge variant={health.variant}>{health.label}</StatusBadge>
              {collection.currentRunStatus === 'PROCESSING' ? (
                <StatusBadge
                  variant="recruiting"
                  className="before:animate-pulse motion-reduce:before:animate-none"
                >
                  수집 중
                </StatusBadge>
              ) : null}
            </>
          }
          stats={[
            ['추적 저장소', count(collection.trackedRepositoryCount, '개')],
            ['지연 저장소', count(collection.staleRepositoryCount, '개')],
            [
              '마지막 수집 성공',
              collection.lastSuccessAt
                ? formatRelativeTime(collection.lastSuccessAt, now)
                : NO_RECORD,
            ],
            ...(collection.nextCycleAt
              ? [
                  [
                    '다음 주기 예상',
                    formatRelativeTime(collection.nextCycleAt, now),
                  ] as const,
                ]
              : []),
            [
              '외부 추적 저장소',
              count(externalCollection.trackedRepositoryCount, '개'),
            ],
            [
              '외부 마지막 수집 성공',
              externalCollection.lastSuccessAt
                ? formatRelativeTime(externalCollection.lastSuccessAt, now)
                : NO_RECORD,
            ],
          ]}
        />
        <AreaRow
          name="알림 메일"
          badges={
            mail.failed7d > 0 ? (
              <StatusBadge variant="pending">실패</StatusBadge>
            ) : (mail.unknown7d ?? 0) > 0 ? (
              <StatusBadge variant="pending">확인 불가</StatusBadge>
            ) : (
              <StatusBadge variant="approved">정상</StatusBadge>
            )
          }
          stats={[
            [
              '최근 7일 발송',
              <data data-mail-outcome="sent" value={mail.sent7d}>
                {count(mail.sent7d, '건')}
              </data>,
            ],
            [
              '실패',
              <data data-mail-outcome="failed" value={mail.failed7d}>
                {count(mail.failed7d, '건')}
              </data>,
            ],
            [
              '확인 불가',
              mail.unknown7d === undefined ? (
                '—'
              ) : (
                <data data-mail-outcome="unknown" value={mail.unknown7d}>
                  {count(mail.unknown7d, '건')}
                </data>
              ),
            ],
            [
              '마지막 발송',
              mail.lastSentAt ? (
                <time dateTime={mail.lastSentAt}>
                  {formatStamp(mail.lastSentAt)}
                </time>
              ) : (
                NO_RECORD
              ),
            ],
          ]}
        />
      </ListPanel>
    </section>
  );
}
