import type { ReactElement } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STAFF_RECRUITMENT_BADGES } from './staff-dashboard-format';
import type { StaffDashboardStatusSummary } from './staff-dashboard-status';

/**
 * 모집 상태 요약 카드.
 *
 * 카드는 셋이다 — 모집중 → 진행중 → 종료. 「내림」은 넷째 카드로 세우지 않고
 * 종료 카드 안에 곁수로 붙인다. 내림은 별도 상태가 아니라 종료의 부분집합이고
 * (내린 프로그램은 언제나 종료로 판정된다), 카드를 넷으로 늘리면 합이 맞지 않는
 * 것처럼 읽히기 때문이다. 그래도 따로 세는 이유는 예정대로 끝난 것과 누군가
 * 판단해서 접은 것의 후속 조치가 다르기 때문이다.
 *
 * 곁수는 「종료 3개 / 내림 1개」처럼 `/`로 잇는다. 포함 관계를 「그중」 같은 말로
 * 풀어 쓰지 않는다 — 기호 하나로 되는 자리에 말을 얹으면 카드가 탁해진다.
 *
 * 다만 `/`는 나란한 두 수처럼도 읽혀 「3 + 1 = 4」로 오해될 수 있다. 그래서
 * 부분집합이라는 사실을 세 겹으로 붙든다:
 *   1) 곁수는 본수와 같은 줄에 서되 활자 등급이 다르다(2xl semibold vs xs muted).
 *      카드 셋의 큰 수만 훑으면 그 합이 곧 전체 프로그램 수다 — 곁수는 그 층에
 *      끼지 않는다.
 *   2) 곁수는 종료 카드 **안**에 있다. 카드 경계가 곧 포함 관계의 그림이다.
 *   3) 화면 낭독기에는 `/`가 관계를 전하지 못하므로 `aria-label`로 관계를
 *      명시한다(「3개, 내림 1개 포함」). 카드 제목(「종료」)이 바로 앞에서 읽히므로
 *      라벨에 상태 이름을 되풀이하지 않는다.
 *
 * 숫자는 검색·필터 이전의 전체 카탈로그 기준이다(`staff-dashboard-page-model.ts`).
 */
export function StaffDashboardStatusSummary({
  summary,
}: {
  readonly summary: StaffDashboardStatusSummary;
}): ReactElement {
  return (
    <section
      aria-label="전체 프로그램 모집 상태"
      className="grid gap-4 sm:grid-cols-3"
    >
      <StatusCount
        label={STAFF_RECRUITMENT_BADGES.recruiting.label}
        count={summary.recruiting}
      />
      <StatusCount
        label={STAFF_RECRUITMENT_BADGES.in_progress.label}
        count={summary.inProgress}
      />
      <StatusCount
        label={STAFF_RECRUITMENT_BADGES.ended.label}
        count={summary.ended}
        subset={{ label: '내림', count: summary.archived }}
      />
    </section>
  );
}

function StatusCount({
  label,
  count,
  subset,
}: {
  readonly label: string;
  readonly count: number;
  /** 본수에 이미 포함된 곁수. 없으면 카드는 수 하나만 말한다. */
  readonly subset?: { readonly label: string; readonly count: number };
}): ReactElement {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className="text-2xl font-semibold tabular-nums"
          aria-label={
            subset === undefined
              ? undefined
              : `${count}개, ${subset.label} ${subset.count}개 포함`
          }
        >
          {count}개
          {subset === undefined ? null : (
            <span className="text-xs font-normal text-muted-foreground">
              {' / '}
              {subset.label} {subset.count}개
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
