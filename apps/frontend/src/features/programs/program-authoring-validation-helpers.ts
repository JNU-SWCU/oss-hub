import type { ProgramAuthoringStep } from './program-authoring-model';

export type ProgramAuthoringIssue = {
  readonly path: string;
  readonly step: ProgramAuthoringStep;
  readonly message: string;
};

export function required(
  issues: ProgramAuthoringIssue[],
  value: string,
  path: string,
  message: string,
  step: ProgramAuthoringStep = 'basic',
): void {
  if (value.trim().length === 0) issues.push(issue(path, step, message));
}

export function issue(
  path: string,
  step: ProgramAuthoringStep,
  message: string,
): ProgramAuthoringIssue {
  return { path, step, message };
}

// 일정 단계는 시작·종료 오류를 기간 한 줄로 합쳐 보인다
// (`program-schedule-range-editor.tsx`의 rangeError).
const SCHEDULE_LINE: Readonly<Record<string, string>> = {
  applicationStartAt: 'application',
  applicationEndAt: 'application',
  operationStartAt: 'operation',
  operationEndAt: 'operation',
};

/**
 * 지금 단계 화면에 실제로 보이는 오류 줄 수 — R-16 상단 요약의 개수다.
 * `issues.length`를 그대로 쓰지 않는 이유는 셋이다. ① 최종 검토에서 돌아오면
 * 다른 단계의 오류가 함께 들어 있다. ② 같은 칸의 오류가 두 번 쌓일 수 있다
 * (신청 종료). ③ 일정은 시작·종료가 한 줄이다. 마일스톤 단계에서 페이지에
 * 보이는 줄은 `milestones` 하나뿐이다 — 항목별 오류는 편집 창 안에 뜬다.
 */
export function visibleAuthoringIssueCount(
  issues: readonly ProgramAuthoringIssue[],
  step: ProgramAuthoringStep,
): number {
  const lines = new Set<string>();
  for (const item of issues) {
    if (item.step !== step) continue;
    if (step === 'milestones' && item.path !== 'milestones') continue;
    lines.add(SCHEDULE_LINE[item.path] ?? item.path);
  }
  return lines.size;
}

export function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const time = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(time) ? time : null;
}
