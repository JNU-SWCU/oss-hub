import { Search } from 'lucide-react';
import type { FormEvent } from 'react';
import { PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MatrixQuickFilter } from '../matrix';
import type { SubmissionMatrixPage } from '../types';
import { MatrixBody } from './submission-matrix-body';
import {
  MatrixFocusSummary,
  MatrixStageNavigation,
} from './submission-matrix-stage-navigation';

const SECTION_BODY = 'flex min-w-0 flex-col gap-8';
const FILTER_ROW =
  'grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end';

export interface SubmissionMatrixViewProps {
  readonly programId: string;
  readonly data: SubmissionMatrixPage | null;
  readonly search: string;
  readonly filterActive: boolean;
  readonly quickFilter: MatrixQuickFilter;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly now: Date;
  readonly selectedMilestoneId: string | null;
  readonly onSearchChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onQuickFilterChange: (filter: MatrixQuickFilter) => void;
  readonly onResetFilters: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onSelectMilestone: (milestoneId: string | null) => void;
}

export function SubmissionMatrixView(props: SubmissionMatrixViewProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };
  const hasActiveFilter =
    props.search.trim() !== '' || props.quickFilter !== 'ALL';
  const selectedMilestone =
    props.data?.milestones.find(
      (milestone) => milestone.id === props.selectedMilestoneId,
    ) ?? null;

  return (
    <PageBody>
      <PageHeader
        title="서류 현황"
        description={
          <span className="break-keep">
            팀·개인별 제출 여부와 제출 시간을 확인합니다.
          </span>
        }
      />
      <div className={SECTION_BODY}>
        {props.data && props.data.milestones.length > 0 ? (
          <MatrixStageNavigation
            milestones={props.data.milestones}
            selectedMilestoneId={selectedMilestone?.id ?? null}
            onSelectMilestone={props.onSelectMilestone}
          />
        ) : null}
        {selectedMilestone ? (
          <MatrixFocusSummary milestone={selectedMilestone} />
        ) : null}
        <form className={FILTER_ROW} onSubmit={submit}>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <label
              htmlFor="matrix-search"
              className="inline-flex items-center gap-2 text-small font-semibold"
            >
              <Search
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              검색
            </label>
            <Input
              id="matrix-search"
              className="h-control w-full min-w-0"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="신청자·팀명·GitHub ID"
            />
          </div>
          <div className="flex w-full min-w-0 gap-2">
            <Button type="submit" className="h-control flex-1 sm:flex-none">
              조회
            </Button>
            {hasActiveFilter ? (
              <Button
                type="button"
                variant="outline"
                className="h-control flex-1 sm:flex-none"
                onClick={props.onResetFilters}
              >
                초기화
              </Button>
            ) : null}
          </div>
        </form>
        {props.errorMessage !== null ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{props.errorMessage}</span>
              <Button
                type="button"
                variant="outline"
                className="h-control"
                onClick={props.onRetry}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <MatrixBody {...props} />
      </div>
    </PageBody>
  );
}
