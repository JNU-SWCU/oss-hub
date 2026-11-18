import type { ReactNode } from 'react';
import { PageBody, PageHeader, TeamSearchForm } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { MatrixQuickFilter } from '../matrix';
import type { SubmissionMatrixPage } from '../types';
import { MatrixBody } from './submission-matrix-body';

const SECTION_BODY = 'flex min-w-0 flex-col gap-8';

export interface SubmissionMatrixViewProps {
  readonly programId: string;
  readonly data: SubmissionMatrixPage | null;
  readonly search: string;
  readonly filterActive: boolean;
  readonly quickFilter: MatrixQuickFilter;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly now: Date;
  readonly headerActions?: ReactNode;
  readonly onSearchChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onQuickFilterChange: (filter: MatrixQuickFilter) => void;
  readonly onResetFilters: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

export function SubmissionMatrixView(props: SubmissionMatrixViewProps) {
  return (
    <PageBody>
      <PageHeader title="서류 현황" actions={props.headerActions} />
      <div className={SECTION_BODY}>
        <TeamSearchForm
          inputId="matrix-search"
          search={props.search}
          resettable={props.search.trim() !== '' || props.quickFilter !== 'ALL'}
          onSearchChange={props.onSearchChange}
          onSearch={props.onSearch}
          onReset={props.onResetFilters}
        />
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
