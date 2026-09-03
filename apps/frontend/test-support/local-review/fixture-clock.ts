import { milestoneDeadline } from '@/features/submissions/submission-checklist';

/**
 * 로컬 검토 픽스처의 **기준 시각**과 그로부터 만드는 상대 시각.
 *
 * 왜 필요한가 — 픽스처의 시각은 거의 다 고정된 ISO 문자열이고, 그 값이 그리는 상태는
 * 날짜가 지나면 조용히 바뀐다. 「마감 전」으로 적어 둔 마일스톤은 그날이 오면 「마감 지남」이
 * 되고, 그 상태에서만 열리는 화면(재제출 폼 같은 것)은 아무도 다시 볼 수 없게 된다.
 * 실제로 이 픽스처의 학생 마일스톤은 **전부 마감이 지나 있고**, dueAt 이 지난 뒤에도
 * 남아 있는 `deadlineLabel: 'D-10'` 같은 값이 화면과 어긋난다.
 *
 * 그래서 「지금으로부터 며칠」이 뜻인 시각은 고정 값으로 박지 않고 여기서 만든다.
 * backend 시드가 `SEED_NOW` + `offsetDays()`로 같은 일을 한다
 * (`apps/backend/prisma/seeds/helpers.ts`) — 이름과 부호 규칙(양수는 미래, 음수는 과거)을
 * 그쪽에 맞춘다.
 *
 * ⚠ 기준 시각은 **모듈이 처음 불릴 때 한 번만** 고정한다. 한 화면이 여러 API 를 부르는
 * 동안 기준이 흔들리면, 같은 마일스톤의 마감이 요청마다 달라져 D-day 와 목록이 어긋난다.
 * backend 시드가 `SEED_NOW`를 프로세스 시작 시점에 고정하는 것과 같은 이유다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const LOCAL_REVIEW_NOW = new Date();

export function localReviewNow(): Date {
  return LOCAL_REVIEW_NOW;
}

/** 기준 시각에서 `days`일 옮긴 순간(ISO). 양수는 미래, 음수는 과거. */
export function offsetDaysFromNow(days: number): string {
  return new Date(LOCAL_REVIEW_NOW.getTime() + days * DAY_MS).toISOString();
}

const SEOUL_TIME_ZONE = 'Asia/Seoul';

/** 기준 시각의 Asia/Seoul 달력 날짜. 마감은 시각이 아니라 **날짜**로 세기 때문이다. */
function seoulCalendarDate(): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(LOCAL_REVIEW_NOW);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
}

export interface LocalReviewDeadline {
  readonly dueAt: string;
  readonly dDay: number;
  readonly deadlineLabel: string;
}

/**
 * 「오늘로부터 `days`일 뒤 마감」인 마일스톤 마감. 실제 마일스톤처럼 그날 23:59:59(KST)로
 * 끝난다.
 *
 * `dDay`·`deadlineLabel` 을 **여기서 함께 만든다**. 실제 backend 가 그 둘을 계산해 내려
 * 보내는 값이라, 픽스처가 `dueAt` 만 상대 시각으로 바꾸고 라벨은 손으로 적으면 마감이
 * 옮겨 갈 때마다 배지만 낡은 값으로 남는다 — 지금 픽스처에 남아 있는 「D-10 인데 마감이
 * 지난」 마일스톤이 정확히 그 모양이다. 계산 규칙은 화면이 쓰는 것과 같은 함수를 그대로
 * 부른다(`milestoneDeadline`, backend `program-deadline.ts` 와 같은 규칙).
 */
export function deadlineDaysFromNow(days: number): LocalReviewDeadline {
  const { year, month, day } = seoulCalendarDate();
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number): string => String(value).padStart(2, '0');
  const dueAt = `${shifted.getUTCFullYear()}-${pad(
    shifted.getUTCMonth() + 1,
  )}-${pad(shifted.getUTCDate())}T23:59:59.000+09:00`;
  const { dDay, label } = milestoneDeadline(dueAt, LOCAL_REVIEW_NOW);
  return { dueAt, dDay, deadlineLabel: label };
}
