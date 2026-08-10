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

export function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const time = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(time) ? time : null;
}
