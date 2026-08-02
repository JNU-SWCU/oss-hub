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
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-page', 'text-section', 'text-body', 'text-small'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
