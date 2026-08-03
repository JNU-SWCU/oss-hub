import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { DataTable, StatusBadge, type DataTableColumn } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { programHref, staffProgramHref } from './program-paths';
import {
  formatStaffApplicationPeriod,
  getStaffRecruitmentBadge,
  STAFF_CATEGORY_LABELS,
} from './staff-dashboard-format';
import {
  StaffActivityInsights,
  StaffApplicationInsights,
  StaffSubmissionInsights,
} from './staff-dashboard-insights';
import type { StaffDashboardProgramSummary } from './types';

interface StaffDashboardOverviewProps {
  readonly programs: readonly StaffDashboardProgramSummary[];
  readonly totalPrograms?: number;
  readonly now: Date;
}

export function StaffDashboardOverview({
  programs,
  totalPrograms = programs.length,
  now,
}: StaffDashboardOverviewProps): ReactElement {
  const columns: DataTableColumn<StaffDashboardProgramSummary>[] = [
    {
      id: 'program',
      header: '프로그램',
      cell: (program) => <ProgramIdentity program={program} now={now} />,
      cellClassName: 'align-top',
    },
    {
      id: 'applications',
      header: '신청',
      cell: (program) => (
        <StaffApplicationInsights applications={program.applications} />
      ),
      cellClassName: 'align-top',
    },
    {
      id: 'activity',
      header: '활동',
      cell: (program) => <StaffActivityInsights activity={program.activity} />,
      cellClassName: 'align-top',
    },
    {
      id: 'submissions',
      header: '제출',
      cell: (program) => (
        <StaffSubmissionInsights submissions={program.submissions} />
      ),
      cellClassName: 'align-top',
    },
    {
      id: 'actions',
      header: '바로가기',
      cell: (program) => <StaffDashboardActions program={program} />,
      cellClassName: 'align-top',
    },
  ];

  return (
    <>
      <div className="hidden xl:block">
        <DataTable
          columns={columns}
          data={[...programs]}
          rowKey={(program) => program.id}
          caption={`총 ${totalPrograms}개 프로그램 운영 현황`}
          className="[&_tbody_tr]:relative [&_tbody_tr]:cursor-pointer [&_tbody_tr:has(a:focus-visible)]:ring-2 [&_tbody_tr:has(a:focus-visible)]:ring-ring [&_tbody_tr:has(a:focus-visible)]:ring-inset"
        />
      </div>
      <section
        aria-label="모바일 프로그램 운영 현황"
        className="grid gap-4 xl:hidden"
      >
        {programs.map((program) => (
          <Card className="relative min-w-0" key={program.id}>
            <CardHeader>
              <ProgramIdentity program={program} now={now} />
            </CardHeader>
            <CardContent className="grid gap-5">
              <InsightSection title="신청">
                <StaffApplicationInsights applications={program.applications} />
              </InsightSection>
              <InsightSection title="활동">
                <StaffActivityInsights activity={program.activity} />
              </InsightSection>
              <InsightSection title="제출">
                <StaffSubmissionInsights submissions={program.submissions} />
              </InsightSection>
            </CardContent>
            <CardFooter>
              <StaffDashboardActions program={program} />
            </CardFooter>
          </Card>
        ))}
      </section>
    </>
  );
}

function ProgramIdentity({
  program,
  now,
}: {
  readonly program: StaffDashboardProgramSummary;
  readonly now: Date;
}): ReactElement {
  const badge = getStaffRecruitmentBadge(program, now);
  return (
    <div className="grid min-w-0 gap-1">
      <CardTitle className="break-keep text-base">
        <Link
          href={staffProgramHref(program.id, '/edit')}
          aria-label={`${program.name} 편집`}
          className="font-medium break-keep underline-offset-4 after:absolute after:inset-0 after:z-[1] hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {program.name}
        </Link>
      </CardTitle>
      <CardDescription>
        {STAFF_CATEGORY_LABELS[program.category]}
      </CardDescription>
      <span className="text-xs text-muted-foreground">
        {formatStaffApplicationPeriod(program)}
      </span>
      <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
    </div>
  );
}

function InsightSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={title} className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function StaffDashboardActions({
  program,
}: {
  readonly program: StaffDashboardProgramSummary;
}): ReactElement {
  return (
    <div className="relative z-10 flex min-w-0 flex-wrap gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={programHref(program.id)}>프로그램</Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href={programHref(program.id, '#activity')}>활동 상세</Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href={program.applicantsPath}>신청자</Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href={staffProgramHref(program.id, '/submissions')}>
          제출 현황
        </Link>
      </Button>
    </div>
  );
}
