import {
  TEAM_ACTIVITY_METRICS,
  type TeamActivity,
  type TeamActivityCounts,
  type TeamActivityMember,
} from './team-activity-api';

const DAY_MS = 86_400_000;

const SEOUL_OFFSET_MS = 9 * 3_600_000;

function seoulDay(value: string): number {
  return value.includes('T')
    ? Math.floor((Date.parse(value) + SEOUL_OFFSET_MS) / DAY_MS)
    : Date.parse(`${value}T00:00:00Z`) / DAY_MS;
}

function mondayOf(day: number): number {
  return day - ((((day + 3) % 7) + 7) % 7);
}

interface WeeklyMemberActivity {
  readonly member: TeamActivityMember;

  readonly contributed: boolean;

  readonly weeks: readonly TeamActivityCounts[];
}

export interface WeeklyActivity {
  readonly weeks: readonly string[];
  readonly members: readonly WeeklyMemberActivity[];
}

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
