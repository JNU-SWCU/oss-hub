import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  NotificationSettingsResponseError,
  classifyNotificationApiError,
  getMyNotificationSettings,
  updateMyNotificationEmail,
} from './api';

const settings = {
  notificationEmail: 'staff@example.com',
  notifyEnabled: true,
};

afterEach(() => vi.unstubAllGlobals());

test('현재 설정을 GET으로 조회한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(settings), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(getMyNotificationSettings()).resolves.toEqual(settings);
  expect(fetchMock).toHaveBeenCalledWith(
    apiPath('users/me/notification-email'),
    undefined,
  );
});
test('수신 이메일·on/off를 PATCH JSON 본문으로 저장한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(settings), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(updateMyNotificationEmail(settings)).resolves.toEqual(settings);
  expect(fetchMock).toHaveBeenCalledWith(
    apiPath('users/me/notification-email'),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    },
  );
});

test('형식이 어긋난 응답은 거부한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ notifyEnabled: 'yes' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  await expect(updateMyNotificationEmail(settings)).rejects.toBeInstanceOf(
    NotificationSettingsResponseError,
  );
});

test('NOT_001 403은 forbidden, Origin 403은 generic, 401은 unauthorized로 분류한다', () => {
  const problem = (status: number, code: string) => ({
    type: 'about:blank',
    title: 't',
    status,
    detail: 'd',
    instance: 'i',
    code,
  });
  expect(
    classifyNotificationApiError(new ApiError(problem(403, 'NOT_001'))),
  ).toBe('forbidden');
  expect(
    classifyNotificationApiError(new ApiError(problem(403, 'AUT_002'))),
  ).toBe('generic');
  expect(
    classifyNotificationApiError(new ApiError(problem(401, 'AUT_003'))),
  ).toBe('unauthorized');
  expect(
    classifyNotificationApiError(new ApiError(problem(404, 'NOT_002'))),
  ).toBe('not-found');
  expect(classifyNotificationApiError(new Error('boom'))).toBe('generic');
});
