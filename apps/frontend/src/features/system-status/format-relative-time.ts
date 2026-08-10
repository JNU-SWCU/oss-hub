// `audit-log-view.tsx`의 상대 시각 포맷과 같은 규칙이다(#736 계열 관리자 화면에서
// 반복해서 필요해짐). 지금은 그 파일이 export하지 않아 공유할 수 없으므로 이 기능
// 안에서 다시 만든다 — 다음에 세 번째 화면이 필요로 하면 `src/lib`로 끌어올린다.

// 큰 단위부터 순서대로 훑어, 경과 시간이 그 단위의 임계값을 넘는 첫 단위로 표시한다
// (예: 90분 경과 → hour 임계값 3600초를 넘으므로 "1시간 전"). 1분 미만은 RelativeTimeFormat이
// "0분 전" 같은 어색한 값을 낼 수 있어 "방금 전"으로 따로 처리한다.
const RELATIVE_TIME_UNITS: readonly (readonly [
  Intl.RelativeTimeFormatUnit,
  number,
])[] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat('ko', {
  numeric: 'auto',
});

export function formatRelativeTime(value: string, now: Date): string {
  const diffSeconds = Math.round(
    (new Date(value).getTime() - now.getTime()) / 1000,
  );
  if (Math.abs(diffSeconds) < 60) return '방금 전';
  for (const [unit, secondsInUnit] of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return relativeTimeFormatter.format(
        Math.round(diffSeconds / secondsInUnit),
        unit,
      );
    }
  }
  return relativeTimeFormatter.format(Math.round(diffSeconds / 60), 'minute');
}
