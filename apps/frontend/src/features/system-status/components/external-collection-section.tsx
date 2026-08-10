import { Users } from 'lucide-react';
import { EmptyState, SectionHeading } from '@/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ExternalCollectionStatus } from '../types';

/**
 * 시스템 상태 3단계 — 조직(org) 수집과 별개로 학생 개인 공개 GitHub 저장소를
 * 수집하는 external 파이프라인의 현황. `collection-streams-table.tsx`(동시
 * 진행 중인 pagination 작업)와 `collection-activity-feed.tsx`(이미 scope로
 * external을 다루는 활동 피드)는 건드리지 않고 완전히 새 섹션으로 분리한다.
 *
 * 이 섹션의 0값은 "탐색된 저장소가 없다"는 뜻이지 "파이프라인이 안 돈다"는 뜻이
 * 아니다 — external sweep은 org sweep과 함께 매시 정각 자동 실행되지만, 어떤
 * 저장소를 볼지 찾아내는 저장소 탐색(discovery)은 자동 배치가 없고 관리자가
 * GitHub 계정 단위로 한 명씩 실행해야 한다. 이 사실을 빈 상태 문구에서 정확히
 * 설명한다 — "0을 그냥 0으로 보여주면 쓸모가 없다"는 이 화면의 원칙.
 *
 * 단, "왜 0인지"의 원인(예: 지금까지 탐색을 실행한 학생이 없었는지, 실행했지만
 * 공개 기여 저장소가 없었는지)은 코드 어디에도 기록되지 않는다 — 저장소 탐색
 * 실행 이력 자체를 남기지 않기 때문에 구분할 근거가 없다. 그래서 문구는 관측
 * 가능한 사실(탐색 대상 0개, 그래서 매시 수집도 처리할 저장소 없이 끝남, 탐색은
 * 관리자가 학생별로 수동 실행해야 함)만 단정하고, 0인 원인은 단정하지 않는다.
 */
const EXTERNAL_EMPTY_TITLE = '탐색된 학생 개인 GitHub 저장소가 아직 없습니다';
const EXTERNAL_EMPTY_DESCRIPTION =
  '학생 개인 공개 GitHub 저장소를 읽어 오는 수집 파이프라인은 조직 수집과 함께 매시 정각 자동으로 실행되고 있습니다. 다만 어떤 저장소를 수집할지 찾아내는 저장소 탐색은 자동으로 돌지 않고, 관리자가 학생별로 GitHub 계정을 한 명씩 지정해 실행해야 합니다. 현재 수집 대상 저장소가 0개라 매시 수집도 처리할 저장소 없이 끝나고 있습니다. 학생별로 저장소 탐색을 실행하면 다음 수집 주기부터 값이 채워집니다.';

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
        <EmptyState
          icon={<Users className="size-8" />}
          title={EXTERNAL_EMPTY_TITLE}
          description={EXTERNAL_EMPTY_DESCRIPTION}
        />
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
                <dt className="text-muted-foreground">탐색된 학생 저장소</dt>
                <dd className="mt-1 font-medium">
                  {status.trackedRepositoryCount}개
                </dd>
              </div>
              <div>
                {/* 누적 값은 CollectionSweepHistory 합산이라 보관 기간을 넘어선
                    과거 sweep은 반영되지 않는다(collection-read.port.ts 참고). */}
                <dt className="text-muted-foreground">누적 수집 활동</dt>
                <dd className="mt-1 font-medium">
                  커밋 {status.cumulativeCommitCount} · PR{' '}
                  {status.cumulativePullRequestCount} · 릴리즈{' '}
                  {status.cumulativeReleaseCount}
                </dd>
              </div>
              {status.lastSweep ? (
                <>
                  <div>
                    <dt className="text-muted-foreground">
                      최근 external sweep 종료
                    </dt>
                    <dd className="mt-1 font-medium">
                      {formatTimestamp(status.lastSweep.sweepFinishedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">최근 sweep 처리</dt>
                    <dd className="mt-1 font-medium">
                      저장소 {status.lastSweep.processedRepositoryCount}/
                      {status.lastSweep.attemptedRepositoryCount}
                      {status.lastSweep.failedRepositoryCount > 0
                        ? ` · 실패 ${status.lastSweep.failedRepositoryCount}`
                        : ''}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
