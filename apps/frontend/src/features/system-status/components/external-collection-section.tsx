import { Users } from 'lucide-react';
import { EmptyState, SectionHeading } from '@/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ExternalCollectionStatus } from '../types';
import { MetricCounts } from './collection-activity-feed';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value: string | null) {
  return value ? DATE_TIME_FORMAT.format(new Date(value)) : '기록 없음';
}

export interface ExternalCollectionSectionProps {
  readonly status: ExternalCollectionStatus;
}

export function ExternalCollectionSection({
  status,
}: ExternalCollectionSectionProps) {
  const isEmpty = status.trackedRepositoryCount === 0;

  return (
    <section aria-label="외부 저장소 수집" className="flex flex-col gap-4">
      <SectionHeading
        title="외부 저장소 수집"
        meta={`${status.trackedRepositoryCount}개 추적 중`}
      />
      {isEmpty ? (
        <div className="grid gap-6 rounded-card border border-dashed border-border p-6">
          <EmptyState
            className="border-0 p-0"
            icon={<Users className="size-8" />}
            title="수집 대상 학생 개인 저장소가 없습니다"
            description={
              status.lastSweep
                ? '최근 수집은 완료됐지만 대상 저장소가 0개입니다. 저장소를 연결하면 바로 수집을 시작합니다.'
                : '완료된 수집 기록도 없습니다. 먼저 스케줄러 실행과 런타임 설정을 확인해 주세요.'
            }
          />
          <div className="grid gap-2 text-sm">
            <p className="font-medium">수집 대상 추가 방법</p>
            <p className="text-muted-foreground">
              팀장이나 교직원이 프로그램 팀 화면에서 조직 밖 공개 저장소 주소를
              연결합니다. 연결된 동안만 수집하고, 저장소를 바꾸거나
              팀·프로그램을 삭제하면 더 수집하지 않습니다.
            </p>
            <p className="text-muted-foreground">
              외부 수집은 조직 수집과 함께 매시 정각 실행하도록 설정되어
              있습니다. 대상 저장소가 연결되고 스케줄러가 정상 동작하면 수집
              결과가 표시됩니다.
            </p>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users aria-hidden="true" className="size-5" />
              학생 개인 저장소 수집 현황
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">연결된 학생 저장소</dt>
                <dd className="mt-1 font-medium">
                  {status.trackedRepositoryCount}개
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">누적 수집 활동</dt>
                <dd className="mt-1 font-medium">
                  <MetricCounts
                    counts={[
                      ['Commit', status.cumulativeCommitCount],
                      ['PR', status.cumulativePullRequestCount],
                      ['Release', status.cumulativeReleaseCount],
                      ['Issue', status.cumulativeIssueCount],
                    ]}
                  />
                </dd>
              </div>
              {status.lastSweep ? (
                <>
                  <div>
                    <dt className="text-muted-foreground">
                      최근 외부 수집 실행 종료
                    </dt>
                    <dd className="mt-1 font-medium">
                      {formatTimestamp(status.lastSweep.sweepFinishedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">최근 실행 처리</dt>
                    <dd className="mt-1 font-medium">
                      저장소 {status.lastSweep.processedRepositoryCount}/
                      {status.lastSweep.attemptedRepositoryCount}
                      {status.lastSweep.failedRepositoryCount > 0
                        ? ` · 실패 ${status.lastSweep.failedRepositoryCount}`
                        : ''}
                    </dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt className="text-muted-foreground">
                    최근 외부 수집 실행 종료
                  </dt>
                  <dd className="mt-1 font-medium">아직 완료된 수집 없음</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
