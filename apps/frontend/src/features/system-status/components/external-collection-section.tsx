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
 * 저장소가 수집 대상(`GithubRepository.source = 'EXTERNAL_PUBLIC'`)이 되는지는
 * 자동으로 정해지지 않는다. **이 대상은 두 경로로만 채워진다**:
 *   ① 학생이 프로그램 신청에서 개인 저장소를 OWN 모드로 연결하고 그 신청이
 *      승인되는 경로 — 승인 시점에 `RepositoryProvisionWorker`가 편입한다.
 *      단, 프로그램의 `repositoryProvisioningEnabled`(관리자 화면 라벨은
 *      "신청 승인 시 GitHub 저장소 자동 생성")가 꺼져 있으면
 *      `applications.service.ts`가 OWN/NEW 구분 없이 편입 자체를 건너뛴다
 *      (outbox 이벤트도 job도 안 만든다, `repository-provision.worker.ts`도
 *      같은 조건을 `FEATURE_DISABLED`로 한 번 더 막는다) — 이 옵션이 꺼진
 *      프로그램에서는 학생이 OWN을 골라 신청하고 승인까지 받아도 ①로는
 *      채워지지 않는다. 그런데 학생용 신청 화면(`program-apply-views.tsx`)의
 *      OWN 선택지는 이 플래그와 무관하게 항상 보인다 — 그래서 문구에 이
 *      전제조건을 반드시 적어야 한다, 안 그러면 "OWN으로 신청해 승인까지
 *      받았는데 왜 안 잡히지"를 관리자가 이 화면만 보고는 풀 수 없다.
 *   ② 관리자가 학생별로 저장소 탐색(discovery)을 수동 실행하는 경로.
 * 두 경로는 코드상 같은 편입 함수(`enrollExternalRepository`)를 호출해 같은
 * `source`값으로 저장되므로 결과 행만 보고는 어느 경로로 들어왔는지 구분할 수
 * 없다. 예전 문구는 ②만 유일한 해법인 것처럼 적어 ①로 이미 채워진 경우조차
 * "학생별로 탐색을 실행해야 한다"고 잘못 안내했다 — 그래서 지금은 두 경로를
 * 모두 설명한다. 새 편입 경로가 추가되면 이 문구도 그 경로를 반영하는지 함께
 * 확인해야 같은 실수가 반복되지 않는다.
 *
 * 단, "왜 0인지"의 원인(예: 지금까지 두 경로 모두 한 번도 실행되지 않았는지,
 * 실행은 됐지만 대상이 없었는지)은 코드 어디에도 기록되지 않는다 — 저장소 탐색
 * 실행 이력도, 신청 승인과 편입 결과를 잇는 인과 관계도 따로 남기지 않기
 * 때문에 구분할 근거가 없다. 그래서 문구는 관측 가능한 사실(탐색 대상 0개,
 * 그래서 매시 수집도 처리할 저장소 없이 끝남, 대상은 위 두 경로로만 채워짐)만
 * 단정하고, 0인 원인은 단정하지 않는다.
 */
const EXTERNAL_EMPTY_TITLE = '탐색된 학생 개인 GitHub 저장소가 아직 없습니다';
const EXTERNAL_EMPTY_DESCRIPTION =
  '학생 개인 공개 GitHub 저장소를 읽어 오는 수집 파이프라인은 조직 수집과 함께 매시 정각 자동으로 실행되고 있습니다. 이 파이프라인이 처리할 저장소 목록은 두 경로로 채워집니다 — 학생이 프로그램 신청에서 「이미 쓰던 저장소를 연결합니다」를 선택해 저장소 주소를 입력하고 그 신청이 승인되거나(단, 프로그램 설정의 「신청 승인 시 GitHub 저장소 자동 생성」이 꺼져 있으면 이 경로는 동작하지 않습니다), 관리자가 학생별로 저장소 탐색을 실행하는 경우입니다. 현재 수집 대상 저장소가 0개라 매시 수집도 처리할 저장소 없이 끝나고 있습니다. 위 두 경로 중 하나로 저장소가 등록되면 다음 수집 주기부터 값이 채워집니다.';

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
