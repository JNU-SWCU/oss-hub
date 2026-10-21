export type ProgramLifecycle = 'PUBLISHED' | 'ARCHIVED';

export class ProgramLifecycleResponseError extends Error {
  constructor() {
    super('프로그램 게시 상태 응답 형식이 올바르지 않습니다.');
    this.name = 'ProgramLifecycleResponseError';
  }
}

export function hasCompatibleProgramLifecycle(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (!('lifecycle' in value) ||
      value.lifecycle === 'PUBLISHED' ||
      value.lifecycle === 'ARCHIVED')
  );
}

export function parseProgramLifecycle<T>(value: T): T {
  if (!hasCompatibleProgramLifecycle(value)) {
    throw new ProgramLifecycleResponseError();
  }
  return value;
}
