import type { ReactNode } from 'react';
import { PageBody, PageHeader, TeamSearchForm } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { MatrixSort } from '../matrix';
import type { MatrixCell, SubmissionMatrixPage } from '../types';
import { MatrixBody } from './submission-matrix-body';
import { SubmissionStatusFilters } from './submission-matrix-controls';

const SECTION_BODY = 'flex min-w-0 flex-col gap-4';

export interface SubmissionMatrixViewProps {
  readonly programId: string;
  readonly data: SubmissionMatrixPage | null;
  readonly search: string;
  readonly filterActive: boolean;
  readonly status?: MatrixCell['status'];
  readonly sort: MatrixSort;
  readonly direction: 'asc' | 'desc';
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly now: Date;
  readonly headerActions?: ReactNode;
  readonly onSearchChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onStatusChange: (status: MatrixCell['status'] | undefined) => void;
  readonly onSort: (sort: MatrixSort) => void;
  readonly onResetFilters: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

export function SubmissionMatrixView(props: SubmissionMatrixViewProps) {
  return (
    <PageBody className="gap-5 px-4 sm:gap-6 sm:px-12 sm:pt-8">
      <PageHeader title="서류 현황" actions={props.headerActions} />
      <div className={SECTION_BODY}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          {props.data?.milestones.length !== 0 ? (
            <SubmissionStatusFilters
              status={props.status}
              counts={props.data?.statusCounts}
              onStatusChange={props.onStatusChange}
            />
          ) : null}
          <TeamSearchForm
            compact
            inputId="matrix-search"
            search={props.search}
            resettable={
              props.search.trim() !== '' ||
              props.filterActive ||
              props.status !== undefined
            }
            onSearchChange={props.onSearchChange}
            onSearch={props.onSearch}
            onReset={props.onResetFilters}
          />
        </div>
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
