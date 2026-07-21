import { afterEach, expect, test, vi } from 'vitest';

import { ApiError, apiPath } from '@/lib/api-client';
import {
  ConsentResponseError,
  acceptConsent,
  classifyConsentApiError,
  getCurrentConsent,
} from './api';

const currentConsentResponse = {
  policyVersion: 'policy-test-v2',
  requiredItems: [
    { key: 'ALPHA', label: '첫 번째 항목', documentUrl: '/policies/alpha' },
    { key: 'BETA', label: '두 번째 항목', documentUrl: '/policies/beta' },
  ],
  consented: false,
  nextUrl: '/next-from-server',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test('현재 동의 정책을 단일 API 클라이언트 경로로 조회하고 서버 항목 순서를 보존한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(currentConsentResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const result = await getCurrentConsent();

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(
    apiPath('consents/current'),
    undefined,
  );
  expect(result.requiredItems.map((item) => item.key)).toEqual([
    'ALPHA',
    'BETA',
  ]);
});

test('완료 동의를 JSON 본문과 함께 전송하고 서버 응답 경로를 반환한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        policyVersion: 'policy-test-v2',
        consentedAt: '2026-07-21T00:00:00.000Z',
        nextUrl: '/destination-from-response',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    acceptConsent({
      policyVersion: 'policy-test-v2',
      acceptedItems: ['ALPHA', 'BETA'],
    }),
  ).resolves.toEqual({
    policyVersion: 'policy-test-v2',
    consentedAt: '2026-07-21T00:00:00.000Z',
    nextUrl: '/destination-from-response',
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(apiPath('consents'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policyVersion: 'policy-test-v2',
      acceptedItems: ['ALPHA', 'BETA'],
    }),
  });
});

test('알 수 없는 현재 정책 응답을 안전한 타입 오류로 거부한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        policyVersion: 'policy-test-v2',
        requiredItems: [{ key: 'ALPHA', label: '항목' }],
        consented: false,
        nextUrl: '/next-from-server',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(getCurrentConsent()).rejects.toBeInstanceOf(
    ConsentResponseError,
  );
});

test('외부 성공 경로가 섞인 저장 응답을 내비게이션 전에 거부한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        policyVersion: 'policy-test-v2',
        consentedAt: '2026-07-21T00:00:00.000Z',
        nextUrl: 'https://example.test/untrusted',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    acceptConsent({
      policyVersion: 'policy-test-v2',
      acceptedItems: ['ALPHA', 'BETA'],
    }),
  ).rejects.toBeInstanceOf(ConsentResponseError);
});

test.each([
  [401, 'AUT_003', 'unauthorized'],
  [409, 'CON_002', 'stale'],
  [422, 'CON_003', 'validation'],
  [500, 'SYS_001', 'generic'],
] as const)(
  'ProblemDetail %i/%s를 %s 동의 오류로 분류한다',
  (status, code, expected) => {
    const error = new ApiError({
      type: 'about:blank',
      title: '합성 오류',
      status,
      detail: '합성 오류 상세',
      instance: '/consents',
      code,
    });

    expect(classifyConsentApiError(error)).toBe(expected);
  },
);

test('ApiError가 아닌 실패를 generic으로 분류한다', () => {
  expect(classifyConsentApiError(new TypeError('synthetic'))).toBe('generic');
});
