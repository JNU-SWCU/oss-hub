import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * 크기 계단 네 칸(`text-page`·`text-section`·`text-body`·`text-small`)을
 * tailwind-merge에 **글자 크기**로 등록한다.
 *
 * 등록하지 않으면 tailwind-merge는 모르는 `text-…`를 글자 **색**으로 넘겨짚는다.
 * 그러면 `cn('text-primary-foreground', 'text-body')`에서 둘이 같은 그룹으로 묶여
 * 뒤에 온 `text-body`가 앞의 색을 지운다 — 남색 버튼 위 흰 글씨가 조용히 본문
 * 색(회색)으로 떨어져 대비 2:1짜리 버튼이 된다. 실제로 그렇게 났다.
 *
 * globals.css의 `--text-*` 매핑과 이 목록은 함께 움직인다. 계단에 칸을 더하면
 * 여기에도 더한다.
 */
/**
 * globals.css의 `@theme inline`이 만드는 **프로젝트 전용 치수·모서리 토큰**을
 * tailwind-merge에 같은 이름의 척도로 등록한다.
 *
 * 등록하지 않으면 tailwind-merge는 `h-control`·`rounded-card` 같은 이름이 어느
 * 그룹인지 몰라 **지우지 못하고 둘 다 남긴다**. 그다음은 생성된 CSS 순서가 승자를
 * 정하는데 전용 토큰이 뒤에 오므로, 호출부가 나중에 적은 `h-auto`·`rounded-full`이
 * 조용히 무시된다 — 코드를 읽는 사람은 덮어쓴 줄 알고 화면은 그렇지 않다.
 * 실제로 `Button`에 `className="h-auto"`를 얹은 자리들이 전부 44px 그대로였다.
 *
 * globals.css의 `--spacing-*`·`--radius-*` 목록과 이 목록은 함께 움직인다.
 * 토큰을 더하면 여기에도 더한다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        'card',
        'control',
        'row',
        'sidebar-collapsed',
        'sidebar-open',
        'tag',
        'tile',
        'topbar',
      ],
      radius: ['card', 'control'],
    },
    classGroups: {
      'font-size': ['text-page', 'text-section', 'text-body', 'text-small'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
