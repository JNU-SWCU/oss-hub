import { Users } from 'lucide-react';
import { EmptyState, SectionHeading } from '@/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ExternalCollectionStatus } from '../types';
import { MetricCounts } from './collection-activity-feed';

/**
 * 시스템 상태 3단계 — 조직(org) 수집과 별개로 학생 개인 공개 GitHub 저장소를
 * 수집하는 external 파이프라인의 현황. `collection-streams-table.tsx`(동시
 * 진행 중인 pagination 작업)와 `collection-activity-feed.tsx`(이미 scope로
 * external을 다루는 활동 피드)는 건드리지 않고 완전히 새 섹션으로 분리한다.
 *
 * 이 섹션의 0값은 "연결된 저장소가 없다"는 뜻이지 "파이프라인이 안 돈다"는 뜻이
 * 아니다 — external sweep은 org sweep과 함께 매시 정각 자동 실행되도록
 * 설계돼 있다. 단, 이 말은 `status.lastSweep`이 non-null일 때만 근거가 있다
 * (QA57) — `lastSweep === null`은 sweep이 지금까지 단 한 번도 끝난 적이
 * 없다는 뜻이라 스케줄러가 아예 안 돌고 있을 가능성이 있고, 이때 "자동으로
 * 실행되고 있다"고 단정하면 실제로 안 도는 스케줄러를 감추게 된다
 * (`system-status-response.dto.ts`의 `SystemStatusExternalCollectionResponseDto`
 * 참고). 어떤 저장소가 수집 대상(`GithubRepository.source = 'EXTERNAL_PUBLIC'`)이
 * 되는지는 자동으로 정해지지 않는다. **대상은 프로그램 신청에 연결된 조직 밖 저장소뿐이다** —
 * 팀장이나 교직원이 프로그램 팀 화면(`TeamRepositoryPanel`)에서 저장소 주소를 연결하면 그때부터
 * 모으고, 저장소를 바꾸거나 팀·프로그램을 삭제해 연결이 풀리면 더 모으지 않는다(#1453). 예전
 * 문구는 신청 화면의 「내 저장소 연결하기」와 관리자 학생별 탐색을 경로로 안내했는데, 앞의 것은
 * 신청 화면에서 빠졌고(#1446) 뒤의 것은 없앴다(#1453) — 새 연결 경로가 생기면 이 문구도 그
 * 경로를 반영하는지 함께 확인해야 같은 실수가 반복되지 않는다.
 *
 * 단, "왜 0인지"의 원인(예: 아무도 연결하지 않았는지, 연결했다가 풀었는지)은
 * 이 섹션이 읽는 값으로 구분할 수 없다. 그래서 문구는 관측 가능한 사실(대상 0개,
 * 대상은 위 연결로만 채워짐, `lastSweep`의 유무)만 단정하고, 0인 원인은
 * 단정하지 않는다.
 */
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
                {/* 누적 값은 CollectionSweepHistory 합산이라 보관 기간을 넘어선
                    과거 sweep은 반영되지 않는다(collection-read.port.ts 참고). */}
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
                // lastSweep이 null이면 대상은 있지만 sweep이 아직 한 번도
                // 끝난 적이 없다는 뜻이다 — 값을 조용히 생략하면 "수집이
                // 잘 되고 있는데 표시할 게 없다"로 오독될 수 있어 명시한다.
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
