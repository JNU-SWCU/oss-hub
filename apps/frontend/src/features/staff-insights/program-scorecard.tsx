'use client';

import { useState, type ReactElement } from 'react';
import { EmptyState } from '@/components';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KpiTile } from './kpi-tile';
import styles from './program-scorecard.module.css';
import {
  ratioText,
  ProgramCell,
  RecruitmentCell,
  CompositionCell,
  completionTone,
  MetricCell,
  ScorecardLegend,
} from './program-scorecard-cells';
import {
  DEFAULT_SORT,
  PROGRAM_SORTS,
  ScorecardHead,
  sortPrograms,
  type ProgramSort,
  type SortState,
} from './program-scorecard-sort';
import type {
  StaffInsightsProgramRow,
  StaffInsightsProgramSummary,
  StaffInsightsSummary,
} from './types';

const decimalFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});

function ProgramKpis({
  summary,
}: {
  readonly summary: StaffInsightsProgramSummary;
}): ReactElement {
  return (
    <section
      aria-label="프로그램 지표"
      className="grid grid-cols-2 gap-4 lg:grid-cols-4"
    >
      <KpiTile
        label="운영 프로그램"
        value={`${summary.programCount}`}
        note={`모집 중 ${summary.recruitingCount}개`}
      />
      <KpiTile
        label="승인 참여 학생"
        value={`${summary.approvedParticipantCount}`}
        note={`중복 제외 ${summary.uniqueParticipantCount}명`}
      />
      <KpiTile
        label="평균 경쟁률"
        value={ratioText(summary.competitionRatio)}
        note="신청 ÷ 승인"
      />
      <KpiTile
        label="재참여 학생"
        value={
          summary.repeatParticipantRate === null
            ? '—'
            : `${summary.repeatParticipantRate}%`
        }
        note={`2개 이상 프로그램 참여 ${summary.repeatParticipantCount}명`}
      />
    </section>
  );
}

function ProgramScorecard({
  programs,
}: {
  readonly programs: readonly StaffInsightsProgramRow[];
}): ReactElement {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const onSort = (key: ProgramSort): void => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'desc' },
    );
  };
  const rows = sortPrograms(programs, sort);
  const maxApplied = Math.max(0, ...programs.map((row) => row.appliedCount));
  const headProps = { sort, onSort };
  return (
    <Card>
      <CardHeader>
        <CardTitle>프로그램 성과표</CardTitle>
        <CardDescription className="break-keep">
          모집 → 구성 → 완주 → 성과 순으로 읽습니다. 현재 기준 · 기간 미적용
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div
          className={`${styles.container} overflow-hidden rounded-lg border border-border`}
        >
          <Table
            scrollRegionLabel="프로그램 성과표"
            className="min-w-[46rem] break-keep"
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead
                  className={`${styles.programColumn} bg-card px-4 py-3 align-top text-small font-semibold text-foreground`}
                >
                  프로그램
                </TableHead>
                <ScorecardHead
                  title="모집"
                  sortKeys={[PROGRAM_SORTS.COMPETITION]}
                  {...headProps}
                />
                <ScorecardHead
                  title="구성"
                  sortKeys={[
                    PROGRAM_SORTS.PARTICIPANTS,
                    PROGRAM_SORTS.NON_SW_SHARE,
                  ]}
                  {...headProps}
                />
                <ScorecardHead
                  title="완주"
                  sortKeys={[PROGRAM_SORTS.COMPLETION]}
                  {...headProps}
                />
                <ScorecardHead
                  title="성과"
                  sortKeys={[PROGRAM_SORTS.OUTCOME]}
                  {...headProps}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.programId} className="hover:bg-transparent">
                  <TableHead
                    scope="row"
                    className={`${styles.programColumn} bg-card px-4 py-3 text-table font-normal text-foreground`}
                  >
                    <ProgramCell row={row} />
                  </TableHead>
                  <TableCell className="px-4 py-3">
                    <RecruitmentCell row={row} maxApplied={maxApplied} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <CompositionCell row={row} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <MetricCell
                      value={
                        row.completionRate === null
                          ? null
                          : `${row.completionRate}%`
                      }
                      className={
                        row.completionRate === null
                          ? undefined
                          : completionTone(row.completionRate)
                      }
                      label={
                        row.completionRate === null
                          ? '마감된 마일스톤 없음'
                          : `마일스톤 제출 ${row.submittedRequirementCount}/${row.dueRequirementCount}`
                      }
                    />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <MetricCell
                      value={
                        row.contributionsPerParticipant === null
                          ? null
                          : `${decimalFormatter.format(row.contributionsPerParticipant)}건`
                      }
                      label={
                        row.contributionsPerParticipant === null
                          ? '연결된 저장소 없음'
                          : `1인당 팀 저장소 기여 · 활동 팀 ${row.activeTeamCount}/${row.repoTeamCount}`
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ScorecardLegend />
      </CardContent>
    </Card>
  );
}

export function ProgramsTab({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  if (summary.programs.length === 0) {
    return (
      <EmptyState
        title="운영 중인 프로그램이 없습니다"
        description="프로그램을 게시하면 모집·구성·완주·성과를 한 표에서 비교합니다."
      />
    );
  }
  return (
    <div data-slot="program-insights" className="grid gap-6">
      <ProgramKpis summary={summary.programSummary} />
      <ProgramScorecard programs={summary.programs} />
    </div>
  );
}
