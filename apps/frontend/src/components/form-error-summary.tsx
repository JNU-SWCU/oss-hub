import { CircleAlert } from 'lucide-react';

import { Alert, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export interface FormErrorSummaryProps {
  /** 화면에 보이는 필드 오류 줄 수. 둘 미만이면 아무것도 그리지 않는다. */
  readonly count: number;
  /**
   * `inverted`는 가입 무대처럼 `data-surface="inverted"` 안에 놓일 때 쓴다. 그 스코프는
   * `--destructive`를 밝은 붉은색으로 덮지만 `--card`는 덮지 않아, 기본 모양 그대로면
   * 흰 상자 위에 옅은 글자가 선다. 같은 무대의 역할 선택 오류 상자처럼 바탕을 비운다.
   */
  readonly surface?: 'default' | 'inverted';
  readonly className?: string;
}

/**
 * R-16 상단 오류 요약. 폼에 보이는 필드 오류가 둘 이상일 때만 그 **개수**를
 * 폼 맨 위에 한 줄로 알린다. 무엇이 틀렸는지는 칸 옆 `FieldError`가 이미
 * 말하므로 여기서 목록을 다시 적지 않고, 하나뿐이면 아무것도 그리지 않는다.
 *
 * 포커스를 받지 않는다 — 첫 오류 칸으로 포커스를 옮기는 일은 각 폼이 한다.
 * 이 요약은 피드백 표 field 행의 필수 액션이라 inline 행의 「다음 행동 링크」를
 * 따로 두지 않는다. `data-slot`을 덮어써 같은 폼의 서버 실패 `Alert`와
 * 구별되게 한다.
 */
export function FormErrorSummary({
  count,
  surface = 'default',
  className,
}: FormErrorSummaryProps) {
  if (count < 2) return null;
  return (
    <Alert
      variant="destructive"
      data-slot="form-error-summary"
      className={cn(
        surface === 'inverted' && 'border-destructive/40 bg-transparent',
        className,
      )}
    >
      <CircleAlert aria-hidden="true" />
      <AlertTitle>고칠 칸이 {count}개 있습니다</AlertTitle>
    </Alert>
  );
}
