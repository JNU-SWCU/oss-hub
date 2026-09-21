import { ApiError } from '@/lib/api-client';

/**
 * 「없음」을 404로 답하던 옛 백엔드 응답을 `null`로 받는다 — **이행기 전용**이다.
 *
 * 내 신청·내 팀 조회는 없을 때 200 + 빈 본문으로 답하도록 바뀌었다(QA174 / #1303).
 * 그런데 이 저장소는 프런트와 백엔드를 한 번에 배포하지 않는다 — 프런트는 릴리스
 * 발행 즉시 Vercel로 나가고 백엔드는 Jenkins의 10분 주기가 발견한 뒤에야 올라간다
 * (ADR-002). 그 사이 창에서는 새 프런트가 옛 백엔드의 404를 받는다. 이 함수가 없으면
 * 팀이 없는 학생의 화면이 그 시간 동안 오류로 접힌다.
 *
 * 그래서 「없음」을 뜻하던 **그 코드 하나만** null로 접고 나머지 실패는 그대로 올린다.
 * 백엔드가 배포된 뒤에는 이 분기에 아무것도 걸리지 않으므로 후속 티켓에서 지운다.
 */
export function absentAsNull(
  legacyAbsentCode: string,
): (error: unknown) => null {
  return (error: unknown) => {
    if (
      error instanceof ApiError &&
      error.problem.status === 404 &&
      error.problem.code === legacyAbsentCode
    ) {
      return null;
    }
    throw error;
  };
}
