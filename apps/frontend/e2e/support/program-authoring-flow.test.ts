import type { APIResponse } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { expectApiStatus } from './program-authoring-flow';

describe('expectApiStatus', () => {
  it('일치한 HTTP 상태는 Promise로 완료한다', async () => {
    const response = { status: () => 201 } as APIResponse;
    await expect(expectApiStatus(response, 201)).resolves.toBeUndefined();
  });

  it('다른 HTTP 상태는 기존 메시지로 Promise를 거절한다', async () => {
    const response = { status: () => 503 } as APIResponse;
    await expect(expectApiStatus(response, 201)).rejects.toThrow(
      'Expected HTTP 201, received 503.',
    );
  });

  it('상태 조회 예외도 동기 throw 대신 Promise를 거절한다', async () => {
    const failure = new Error('status unavailable');
    const response = {
      status: (): number => {
        throw failure;
      },
    } as APIResponse;
    await expect(expectApiStatus(response, 200)).rejects.toBe(failure);
  });
});
