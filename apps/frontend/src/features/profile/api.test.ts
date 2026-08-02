import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  ProfileResponseError,
  classifyProfileApiError,
  completeMyProfile,
  getMyProfile,
  updateMyProfile,
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

test('완료 사용자는 이름·학과만 PATCH하고 학번은 보내지 않는다', async () => {
  const response = { ...completeRequest, isComplete: true };
  const updateRequest = {
    name: completeRequest.name,
    department: completeRequest.department,
  };
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(updateMyProfile(updateRequest)).resolves.toEqual(response);
  expect(fetchMock).toHaveBeenCalledWith(apiPath('users/me/profile'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updateRequest),
  });
  const body = JSON.parse(
    (fetchMock.mock.calls[0] as [{}, { body: string }])[1].body,
  ) as Record<string, unknown>;
  expect(body).not.toHaveProperty('studentId');
});

test('학번·학과가 비어도 완료로 표시된 응답은 그대로 파싱한다', async () => {
  // 역할마다 필수 항목이 다르고 응답에는 역할이 없다 — 관리자·교직원의 정상 응답을
  // 파서가 모순으로 오판하면 안 된다.
  const staffProfile = { ...emptyProfile, isComplete: true };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(staffProfile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  await expect(getMyProfile()).resolves.toEqual(staffProfile);
});

test('세 필드를 모두 담은 서버 응답도 그대로 파싱한다', async () => {
  const fullProfile = { ...completeRequest, isComplete: true };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fullProfile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  await expect(getMyProfile()).resolves.toEqual(fullProfile);
});

test('공백 이름을 완료로 표시한 프로필 응답을 거부한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ...completeRequest, name: '   ', isComplete: true }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ),
  );

  await expect(getMyProfile()).rejects.toBeInstanceOf(ProfileResponseError);
});

test.each([
  ['빈 학번', { studentId: '' }],
  ['형식이 잘못된 학번', { studentId: '12A456' }],
  ['공백 학과', { department: '   ' }],
] as const)(
  '%s을 완료로 표시한 프로필 응답을 거부한다',
  async (_label, override) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ...completeRequest, ...override, isComplete: true }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    await expect(getMyProfile()).rejects.toBeInstanceOf(ProfileResponseError);
  },
);

test.each([
  [401, 'AUT_003', 'unauthorized'],
  [422, 'CON_003', 'consent-required'],
  [409, 'USR_001', 'already-complete'],
  // 재시도로 풀리지 않는 실패는 따로 분류해야 화면이 "잠시 후 다시"라고 말하지 않는다.
  [409, 'USR_004', 'student-id-taken'],
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
