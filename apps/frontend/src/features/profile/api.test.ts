import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  ProfileResponseError,
  classifyProfileApiError,
  completeMyProfile,
  getMyProfile,
} from './api';

const emptyProfile = {
  name: 'GitHub 합성 이름',
  studentId: null,
  department: null,
  isComplete: false,
};
const completeRequest = {
  name: '합성 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
};

afterEach(() => vi.unstubAllGlobals());

test('본인 프로필을 단일 API 클라이언트 경로로 조회한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(emptyProfile), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(getMyProfile()).resolves.toEqual(emptyProfile);
  expect(fetchMock).toHaveBeenCalledWith(
    apiPath('users/me/profile'),
    undefined,
  );
});

test('완료 프로필을 PATCH JSON 본문으로 저장한다', async () => {
  const response = { ...completeRequest, isComplete: true };
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(completeMyProfile(completeRequest)).resolves.toEqual(response);
  expect(fetchMock).toHaveBeenCalledWith(apiPath('users/me/profile'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(completeRequest),
  });
});

test('완료 플래그와 필드가 모순된 응답을 거부한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...emptyProfile, isComplete: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  await expect(getMyProfile()).rejects.toBeInstanceOf(ProfileResponseError);
});

test.each([
  [401, 'AUT_003', 'unauthorized'],
  [422, 'CON_003', 'consent-required'],
  [409, 'USR_001', 'already-complete'],
  [500, 'SYS_001', 'generic'],
] as const)(
  'ProblemDetail %i/%s를 %s 프로필 오류로 분류한다',
  (status, code, expected) => {
    const error = new ApiError({
      type: 'about:blank',
      title: '합성 오류',
      status,
      detail: '합성 오류 상세',
      instance: '/users/me/profile',
      code,
    });

    expect(classifyProfileApiError(error)).toBe(expected);
  },
);
