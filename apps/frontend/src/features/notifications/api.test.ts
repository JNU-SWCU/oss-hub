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

test('403은 forbidden, 401은 unauthorized, 그 외는 generic으로 분류한다', () => {
  const problem = (status: number) => ({
    type: 'about:blank',
    title: 't',
    status,
    detail: 'd',
    instance: 'i',
    code: 'NOT_001',
  });
  expect(classifyNotificationApiError(new ApiError(problem(403)))).toBe(
    'forbidden',
  );
  expect(classifyNotificationApiError(new ApiError(problem(401)))).toBe(
    'unauthorized',
  );
  expect(classifyNotificationApiError(new ApiError(problem(404)))).toBe(
    'not-found',
  );
  expect(classifyNotificationApiError(new Error('boom'))).toBe('generic');
});
