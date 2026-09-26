import {
  TEAM_ACTIVITY_METRICS,
  type TeamActivity,
  type TeamActivityCounts,
  type TeamActivityMember,
} from './team-activity-api';

const DAY_MS = 86_400_000;
/** 서울은 1988년 이후 일광 절약 시간이 없어 UTC+9로 고정이다. */
const SEOUL_OFFSET_MS = 9 * 3_600_000;

/** 1970-01-01부터 센 서울 날짜. 달력 날짜는 그대로, 순간(ISO)은 서울 날짜로 읽는다. */
function seoulDay(value: string): number {
  return value.includes('T')
    ? Math.floor((Date.parse(value) + SEOUL_OFFSET_MS) / DAY_MS)
    : Date.parse(`${value}T00:00:00Z`) / DAY_MS;
}

/** 주는 월요일에 시작한다. 1970-01-01은 목요일이다. */
function mondayOf(day: number): number {
  return day - ((((day + 3) % 7) + 7) % 7);
}

export interface WeeklyMemberActivity {
  readonly member: TeamActivityMember;
  /** 창 안에서 센 기여가 하나도 없으면 선을 긋지 않는다 — 범례에는 남는다. */
  readonly contributed: boolean;
  /** `weeks`와 같은 순서의 주별 합. */
  readonly weeks: readonly TeamActivityCounts[];
}

export interface WeeklyActivity {
  /** 각 주의 월요일(`YYYY-MM-DD`, 서울), 오래된 주부터. */
  readonly weeks: readonly string[];
  readonly members: readonly WeeklyMemberActivity[];
}

/**
 * 날마다 드문드문 오는 기여를 월–일 주로 묶는다.
 *
 * 그리는 구간은 프로그램 기간이되 오늘을 넘지 않는다 — 오지 않은 주를 0으로 그리지
 * 않는다. 시작이 센티널(`0001-…`, 「처음부터」)이면 첫 기여에서 시작하고, 기여가
 * 없으면 이번 주 하나다. 받은 기여는 구간 밖이어도 버리지 않고 구간을 넓힌다.
 */
export function weeklyActivity(
  activity: Pick<TeamActivity, 'window' | 'members'>,
  now: number,
): WeeklyActivity {
  const pointDays = activity.members.flatMap((member) =>
    member.points.map((point) => seoulDay(point.date)),
  );
  const today = Math.floor((now + SEOUL_OFFSET_MS) / DAY_MS);
  const end = Math.max(
    Math.min(seoulDay(activity.window.to), today),
    ...pointDays,
  );
  const from = activity.window.from.startsWith('0001-')
    ? Infinity
    : seoulDay(activity.window.from);
  const first = mondayOf(Math.min(from, end, ...pointDays));
  const weeks = Array.from(
    { length: (mondayOf(end) - first) / 7 + 1 },
    (_, index) =>
      new Date((first + index * 7) * DAY_MS).toISOString().slice(0, 10),
  );

  return {
    weeks,
    members: activity.members.map((member) => {
      const buckets = weeks.map(() => ({
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
      }));
      for (const point of member.points) {
        const bucket = buckets[(mondayOf(seoulDay(point.date)) - first) / 7];
        for (const metric of TEAM_ACTIVITY_METRICS) {
          bucket[metric] += point[metric];
        }
      }
      return {
        member,
        contributed: TEAM_ACTIVITY_METRICS.some(
          (metric) => member.totals[metric] > 0,
        ),
        weeks: buckets,
      };
    }),
  };
}
