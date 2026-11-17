import { useLayoutEffect, useRef, type RefObject } from 'react';
import Link from 'next/link';
import { CircleCheck, RotateCcw } from 'lucide-react';
import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatStamp } from '../system-status-format';
import type {
  Anomaly,
  AnomalyRule,
  AnomalySeverity,
  CollectionRepository,
  ProvisioningFailedTeam,
} from '../types';
import { StaleRepositoryList } from './stale-repository-list';

const RULE_LABEL = {
  BULK_REMOVAL: '10분 내 대량 거절·삭제',
  SELF_ADMIN_CHANGE: '본인 관리자 권한 변경',
  OFF_HOURS_ADMIN_CHANGE: '야간·주말 관리자 권한 변경',
  PROVISIONING_FAILED: '저장소 발급 최종 실패',
  COLLECTION_STALE: '활동 수집 지연',
  MAIL_FAILED: '알림 메일 발송 실패',
} as const satisfies Record<AnomalyRule, string>;

const SEVERITY = {
  HIGH: {
    label: '심각',
    variant: 'rejected',
    stripe: 'shadow-[inset_3px_0_0_var(--status-rejected-fg)]',
  },
  MEDIUM: {
    label: '주의',
    variant: 'pending',
    stripe: 'shadow-[inset_3px_0_0_var(--status-pending-fg)]',
  },
} as const satisfies Record<
  AnomalySeverity,
  { label: string; variant: 'rejected' | 'pending'; stripe: string }
>;

const ROW = 'border-t border-border/50 px-card py-3';
const ROW_LINE = 'flex flex-wrap items-center gap-x-3 gap-y-2';
const TEAM_ROW = cn(
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2',
  '[&+&]:border-t [&+&]:border-border/50',
  'sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4',
);
const TEAM_META = cn(
  'col-start-1 text-small text-muted-foreground tabular-nums',
  '[overflow-wrap:anywhere] sm:col-start-2',
);
const TEAM_RETRY = cn(
  'col-start-2 row-span-2 row-start-1',
  'sm:col-start-3 sm:row-span-1 sm:row-start-auto',
  'aria-disabled:pointer-events-none aria-disabled:opacity-50',
);
const CARD_FOCUS =
  'outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const TARGET_LINK = cn(
  'ml-auto w-fit text-small font-semibold',
  'underline underline-offset-2 hover:opacity-80',
);

interface RetryProps {
  readonly retryingTeamIds: readonly string[];
  readonly onRetry: (team: ProvisioningFailedTeam) => void;
}

interface RowProps extends RetryProps {
  readonly cardRef: RefObject<HTMLDivElement | null>;
}

interface AttentionCardProps extends RetryProps {
  readonly anomalies: readonly Anomaly[];
  readonly failedTeams: readonly ProvisioningFailedTeam[];
  readonly staleRepositories: readonly CollectionRepository[];
}

function targetLink({
  target,
}: Anomaly): { readonly href: string; readonly text: string } | null {
  if (target === null) return null;
  if (target.login === null) {
    return {
      href: `/dashboard/users/${encodeURIComponent(target.id)}`,
      text: '사용자 보기',
    };
  }
  const query = new URLSearchParams({ q: target.login });
  return {
    href: `/dashboard/audit-logs?${query.toString()}`,
    text: '감사 로그 보기',
  };
}

function FailedTeamRow({
  team,
  retryingTeamIds,
  onRetry,
  cardRef,
}: RowProps & { readonly team: ProvisioningFailedTeam }) {
  const retrying = retryingTeamIds.includes(team.teamId);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      if (button !== null && button === document.activeElement) {
        cardRef.current?.focus();
      }
    };
  }, [cardRef]);

  return (
    <li className={TEAM_ROW}>
      <p className="col-start-1 font-semibold [overflow-wrap:anywhere]">
        {team.teamName}{' '}
        <span className="font-normal text-muted-foreground">
          {team.programName}
        </span>
      </p>
      <p className={TEAM_META}>
        {team.lastErrorCode ? (
          <>
            <code className="font-mono text-xs">{team.lastErrorCode}</code>
            {' · '}
          </>
        ) : null}
        <time dateTime={team.updatedAt}>{formatStamp(team.updatedAt)}</time>
      </p>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        className={TEAM_RETRY}
        aria-disabled={retrying}
        aria-label={`${team.teamName} 저장소 발급 ${retrying ? '다시 시도 중' : '다시 시도'}`}
        onClick={() => onRetry(team)}
      >
        <RotateCcw
          aria-hidden="true"
          className={
            retrying ? 'animate-spin motion-reduce:animate-none' : undefined
          }
        />
        다시 시도
      </Button>
    </li>
  );
}

function AnomalyRow({
  anomaly,
  failedTeams,
  staleRepositories,
  retryingTeamIds,
  onRetry,
  cardRef,
}: RowProps & {
  readonly anomaly: Anomaly;
  readonly failedTeams: readonly ProvisioningFailedTeam[];
  readonly staleRepositories: readonly CollectionRepository[];
}) {
  const severity = SEVERITY[anomaly.severity];
  const label = RULE_LABEL[anomaly.rule];
  const link = targetLink(anomaly);
  const head = (
    <>
      <StatusBadge variant={severity.variant}>{severity.label}</StatusBadge>
      <span className="font-semibold">{label}</span>
      <span className="text-small text-muted-foreground tabular-nums">
        {`${anomaly.count}건`}
      </span>
    </>
  );
  const detail =
    anomaly.rule === 'PROVISIONING_FAILED' && failedTeams.length > 0 ? (
      <ul className="grid">
        {failedTeams.map((team) => (
          <FailedTeamRow
            key={team.teamId}
            team={team}
            retryingTeamIds={retryingTeamIds}
            onRetry={onRetry}
            cardRef={cardRef}
          />
        ))}
      </ul>
    ) : anomaly.rule === 'COLLECTION_STALE' && staleRepositories.length > 0 ? (
      <StaleRepositoryList repositories={staleRepositories} />
    ) : null;

  if (detail === null) {
    return (
      <li className={cn(ROW, ROW_LINE, 'min-h-control', severity.stripe)}>
        {head}
        {link ? (
          <Link
            href={link.href}
            className={TARGET_LINK}
            aria-label={`${label} ${link.text}`}
          >
            {link.text}
          </Link>
        ) : null}
      </li>
    );
  }

  return (
    <li className={cn(ROW, 'grid gap-3', severity.stripe)}>
      <div className={ROW_LINE}>{head}</div>
      {detail}
    </li>
  );
}

export function AttentionCard({
  anomalies,
  failedTeams,
  staleRepositories,
  retryingTeamIds,
  onRetry,
}: AttentionCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <Card
      ref={cardRef}
      tabIndex={-1}
      role="region"
      aria-label="주의 필요"
      className={cn('gap-0 py-0', CARD_FOCUS)}
    >
      {anomalies.length === 0 ? (
        <p className="flex items-center gap-2 px-card py-4 font-semibold text-status-approved-fg">
          <CircleCheck aria-hidden="true" className="size-5" />
          이상 없음
        </p>
      ) : (
        <>
          <CardHeader className="py-4">
            <CardTitle>
              <h2 className="contents">주의 필요</h2>
            </CardTitle>
          </CardHeader>
          <ul>
            {anomalies.map((anomaly) => (
              <AnomalyRow
                key={`${anomaly.rule}:${anomaly.target?.id ?? ''}`}
                anomaly={anomaly}
                failedTeams={failedTeams}
                staleRepositories={staleRepositories}
                retryingTeamIds={retryingTeamIds}
                onRetry={onRetry}
                cardRef={cardRef}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
