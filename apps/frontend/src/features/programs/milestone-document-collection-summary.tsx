import { FilterChip, FilterChipGroup, SectionHeading } from '@/components';
import { Button } from '@/components/ui/button';
import { collectionDocumentTotalFor } from './milestone-document-collection';
import type {
  MilestoneDocumentCollection,
  MilestoneDocumentCollectionSelection,
} from './milestone-document-collection-api';

interface MilestoneDocumentCollectionSummaryProps {
  readonly data: MilestoneDocumentCollection;
  readonly selection: MilestoneDocumentCollectionSelection | null;
  readonly onSelectionChange: (
    selection: MilestoneDocumentCollectionSelection | null,
  ) => void;
}

export function MilestoneDocumentCollectionSummary({
  data,
  selection,
  onSelectionChange,
}: MilestoneDocumentCollectionSummaryProps) {
  const selected = data.documents.find(
    (document) => document.id === selection?.id,
  );
  const selectedTotal =
    selected === undefined
      ? null
      : collectionDocumentTotalFor(data.documentTotals, selected.id);

  return (
    <section
      aria-labelledby="collection-summary-heading"
      className="flex min-w-0 flex-col gap-4"
    >
      <SectionHeading
        id="collection-summary-heading"
        title="서류별 요약"
        meta={`전체 ${data.filterCounts.all}팀`}
      />
      <p className="text-small text-muted-foreground">
        모든 페이지의 승인된 팀 기준입니다. 서류를 고르면 아래 표에서
        제출·미제출 팀을 확인할 수 있습니다.
      </p>
      <FilterChipGroup aria-label="서류 선택" className="flex-col">
        {data.documents.map((document) => {
          const total = collectionDocumentTotalFor(
            data.documentTotals,
            document.id,
          );
          return (
            <FilterChip
              key={document.id}
              pressed={selection?.id === document.id}
              onClick={() =>
                onSelectionChange({ id: document.id, submissionState: 'ALL' })
              }
              className="h-auto min-h-control w-full flex-wrap justify-between gap-2 px-4 py-3 text-left whitespace-normal"
            >
              <span className="min-w-0 break-words">
                {document.name}
                <span className="ml-2 text-small text-muted-foreground">
                  {document.isRequired ? '필수' : '선택'}
                </span>
              </span>
              <span className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                <span>
                  제출 {total.submitted} / {total.total}팀
                </span>
                <span className="text-muted-foreground">
                  미제출 {total.total - total.submitted}팀
                </span>
              </span>
            </FilterChip>
          );
        })}
      </FilterChipGroup>
      {selected === undefined || selectedTotal === null ? null : (
        <div className="flex flex-col gap-3 rounded-card border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{selected.name} · 팀별 제출 현황</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onSelectionChange(null)}
            >
              모든 서류 보기
            </Button>
          </div>
          <FilterChipGroup aria-label={`${selected.name} 제출 여부`}>
            {[
              ['ALL', `전체 ${selectedTotal.total}팀`],
              [
                'MISSING',
                `미제출 ${selectedTotal.total - selectedTotal.submitted}팀`,
              ],
              ['SUBMITTED', `제출 ${selectedTotal.submitted}팀`],
            ].map(([submissionState, label]) => (
              <FilterChip
                key={submissionState}
                pressed={selection?.submissionState === submissionState}
                onClick={() =>
                  onSelectionChange({
                    id: selected.id,
                    submissionState:
                      submissionState as MilestoneDocumentCollectionSelection['submissionState'],
                  })
                }
              >
                {label}
              </FilterChip>
            ))}
          </FilterChipGroup>
          <p className="text-small text-muted-foreground">
            {selected.isRequired
              ? '필수 서류입니다.'
              : '선택 서류의 미제출은 필수 서류 제출 상태에 영향을 주지 않습니다.'}{' '}
            아래 빠른 필터와 함께 적용되며, 각 필터의 팀 수는 마일스톤 전체
            기준입니다.
          </p>
        </div>
      )}
    </section>
  );
}
