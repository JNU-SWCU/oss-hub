import { AlertCircle, CalendarDays, ChartNoAxesCombined } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ActivityChart } from './activity-chart';
import type {
  ActivityGranularity,
  ActivityProgram,
  ActivityTimeline,
  ActivityTimelineStatus,
} from '../types';

interface ActivityTimelineViewProps {
  data: ActivityTimeline | null;
  granularity: ActivityGranularity;
  status: ActivityTimelineStatus;
  onGranularityChange: (granularity: ActivityGranularity) => void;
  onRetry: () => void;
}

function groupedPrograms(programs: readonly ActivityProgram[]) {
  return Object.entries(
    programs.reduce<Record<string, ActivityProgram[]>>((groups, program) => {
      (groups[program.year] ??= []).push(program);
      return groups;
    }, {}),
  ).sort(([left], [right]) => Number(right) - Number(left));
}

export function ActivityTimelineView({
  data,
  granularity,
  status,
  onGranularityChange,
  onRetry,
}: ActivityTimelineViewProps) {
  const programs = data?.programs ?? [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="내 활동"
        description="참여 프로그램과 오픈소스 활동 추이를 확인합니다."
        actions={
          <div
            role="group"
            aria-label="활동 집계 기간"
            className="inline-flex rounded-md border border-border bg-background p-1"
          >
            {(
              [
                ['MONTH', '월별'],
                ['YEAR', '연도별'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={granularity === value ? 'default' : 'ghost'}
                aria-pressed={granularity === value}
                onClick={() => onGranularityChange(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      <section
        aria-labelledby="programs-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-5 text-primary" />
          <h2
            id="programs-heading"
            className="font-heading text-xl font-semibold"
          >
            참여 프로그램
          </h2>
        </div>
        {status === 'error' ? (
          <p className="text-sm text-destructive" role="status">
            참여 프로그램 정보를 불러오지 못했습니다.
          </p>
        ) : status === 'loading' && !data ? (
          <p className="text-sm text-muted-foreground" role="status">
            활동 정보를 불러오는 중…
          </p>
        ) : programs.length === 0 ? (
          <p className="border-l-2 border-border py-2 pl-4 text-sm text-muted-foreground">
            참여한 프로그램이 없습니다.
          </p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {groupedPrograms(programs).map(([year, items]) => (
              <div
                key={year}
                className="grid gap-3 py-4 sm:grid-cols-[5rem_minmax(0,1fr)]"
              >
                <h3 className="font-heading text-sm font-semibold text-foreground">
                  {year}년
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {items.map((program) => (
                    <li key={program.programId} className="min-w-0 text-sm">
                      <span className="font-medium text-foreground">
                        {program.programName}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {program.applicationMode === 'PERSONAL' ? '개인' : '팀'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="chart-heading"
        className="flex min-w-0 flex-col gap-4"
      >
        <div className="flex items-center gap-2">
          <ChartNoAxesCombined
            aria-hidden="true"
            className="size-5 text-accent"
          />
          <h2 id="chart-heading" className="font-heading text-xl font-semibold">
            활동 추이
          </h2>
        </div>
        {status === 'error' ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>활동 정보를 불러오지 못했습니다</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>잠시 후 다시 시도해 주세요.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        ) : status === 'loading' ? (
          <div className="h-80 animate-pulse rounded-md bg-muted" role="status">
            <span className="sr-only">활동 그래프를 불러오는 중…</span>
          </div>
        ) : data && data.series.points.length > 0 ? (
          <ActivityChart points={data.series.points} />
        ) : (
          <EmptyState
            icon={<ChartNoAxesCombined className="size-8" />}
            title="아직 활동 기록이 없습니다"
            description="프로그램 활동이 수집되면 이곳에 추이가 표시됩니다."
          />
        )}
      </section>
    </main>
  );
}
