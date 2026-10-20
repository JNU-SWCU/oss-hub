import { describe, expect, it } from 'vitest';
import {
  parseProgramLifecycle,
  ProgramLifecycleResponseError,
} from './program-lifecycle';

describe('게시 상태 응답 경계', () => {
  it.each([null, undefined, [], 'PUBLISHED', { lifecycle: undefined }])(
    '객체가 아니거나 필드가 있는데 값이 없는 응답 %s를 거부한다',
    (value) => {
      expect(() => parseProgramLifecycle(value)).toThrow(
        ProgramLifecycleResponseError,
      );
    },
  );
});
