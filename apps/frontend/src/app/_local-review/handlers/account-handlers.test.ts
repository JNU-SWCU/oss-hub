import { describe, expect, it } from 'vitest';
import { parsePublicProfile } from '@/features/profile/public-profile-api';
import { parseMyRepositoriesResponse } from '@/features/repositories/parser';
import {
  createLocalReviewActivation,
  type LocalReviewFixtureId,
} from '../fixture-contract';
import { resolveLocalReviewResponse } from '../fixture-response';

function call(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  search = '',
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(search),
  });
}

/** 고른 역할·입력한 값처럼 요청 본문에만 있는 입력을 함께 보낸다. */
function callWithBody(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  body: unknown,
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(),
    body,
  });
}

function jsonBody(
  plan: ReturnType<typeof resolveLocalReviewResponse>,
  status = 200,
): unknown {
  if (plan.kind !== 'json') throw new Error('expected a json fixture plan');
  expect(plan.status).toBe(status);
  return plan.body;
}

const AUTHENTICATED_FIXTURES = [
  'student',
  'staff',
  'admin',
  'settings',
  'wrong-role',
  'unassigned',
] as const satisfies readonly LocalReviewFixtureId[];

describe('account fixture responses', () => {
  it('serves a public profile that the real parser accepts', () => {
    // Given / When
    const body = jsonBody(
      call('anonymous', 'GET', 'users/synthetic-user-01/public-profile'),
    );

    // Then: 파서가 githubUrl·detailUrl·publishedAt 형식을 모두 검사한다.
    const profile = parsePublicProfile(body);
    expect(profile.githubNickname).toBe('synthetic-contributor-01');
    expect(profile.repositories.map((item) => item.repositoryId)).toEqual([
      'synthetic-repo-capstone',
      'synthetic-repo-contest',
    ]);
    // 공개 아카이브 상세로 이어지는 경로가 끊기지 않아야 한다.
    expect(profile.repositories[0]?.detailUrl).toBe(
      '/archive/synthetic-repo-capstone',
    );
  });

  it('keeps an empty public profile reviewable and 404s unknown users', () => {
    // Given / When
    const empty = jsonBody(
      call('student', 'GET', 'users/synthetic-user-05/public-profile'),
    );
    const missing = call(
      'student',
      'GET',
      'users/synthetic-user-99/public-profile',
    );

    // Then
    expect(parsePublicProfile(empty).repositories).toEqual([]);
    expect(missing).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'PRF_001' },
    });
  });

  it.each(AUTHENTICATED_FIXTURES)(
    '%s fixture can read /my-repos without hitting the failure state',
    (fixture) => {
      // Given / When
      const body = jsonBody(call(fixture, 'GET', 'repositories/me'));

      // Then: 파서는 SUCCEEDED가 아닌 항목의 저장소 필드가 비어 있는지까지 본다.
      const repositories = parseMyRepositoriesResponse(body);
      expect(repositories.items).toHaveLength(4);
      expect(
        repositories.items.map((item) => item.provisionStatus),
      ).toEqual(['SUCCEEDED', 'SUCCEEDED', 'PROCESSING', 'FAILED_FINAL']);
      expect(repositories.items[0]?.canOpenGithub).toBe(true);
      expect(repositories.items[2]?.canOpenGithub).toBe(false);
    },
  );

  it('rejects the signed-out reviewer on account-only reads', () => {
    // Given / When
    const repositories = call('anonymous', 'GET', 'repositories/me');
    const consent = call('anonymous', 'GET', 'consents/current');

    // Then
    expect(repositories).toMatchObject({ kind: 'json', status: 401 });
    expect(consent).toMatchObject({ kind: 'json', status: 401 });
  });

  it('opens the consent screen instead of redirecting straight past it', () => {
    // Given / When
    const body = jsonBody(call('unassigned', 'GET', 'consents/current'));

    // Then: consented가 true면 화면이 즉시 빠져나가 동의 화면을 볼 수 없다.
    expect(body).toMatchObject({
      policyVersion: '2026-07-01',
      consented: false,
      nextUrl: '/onboarding/profile',
    });
    expect((body as { requiredItems: unknown[] }).requiredItems).toHaveLength(3);
  });

  it('lets the approval-waiting reviewer past the consent step', () => {
    // Given / When
    const body = jsonBody(call('role-pending', 'GET', 'consents/current'));

    // Then: 이미 동의를 마친 상태여야 랜딩 진입 버튼(`/consent`)이 1단계에서
    // 멈추지 않고 `/onboarding/pending`까지 이어진다.
    expect(body).toMatchObject({
      policyVersion: '2026-07-01',
      consented: true,
      nextUrl: '/onboarding/profile',
    });
  });

  it('accepts the consent submission with the next onboarding step', () => {
    // Given / When
    const body = jsonBody(call('unassigned', 'POST', 'consents'));

    // Then
    expect(body).toMatchObject({
      policyVersion: '2026-07-01',
      nextUrl: '/onboarding/profile',
    });
    expect(
      Number.isFinite(
        Date.parse((body as { consentedAt: string }).consentedAt),
      ),
    ).toBe(true);
  });

  it('confirms the logout every header exposes', () => {
    // Given / When
    const plan = call('student', 'POST', 'auth/logout');

    // Then: isAuthenticated가 true면 화면이 "로그아웃하지 못했습니다"로 남는다.
    expect(plan).toEqual({
      kind: 'json',
      status: 200,
      body: { isAuthenticated: false },
    });
  });

  it('sends the login link to the role screen instead of raw JSON', () => {
    // Given: 랜딩의 "GitHub으로 로그인"은 fetch가 아니라 링크로 전체 이동한다.
    // When
    const plan = call('anonymous', 'GET', 'auth/github');

    // Then: JSON이면 브라우저가 그 JSON을 그대로 렌더한다 — 이동이어야 한다.
    if (plan.kind !== 'redirect') throw new Error('expected a redirect plan');
    expect(plan.status).toBe(303);
    expect(plan.location).toBe(
      '/local-review/unassigned?to=%2Fonboarding%2Frole%3Fnotice%3Dlocal-review-login',
    );
  });

  it('routes the login redirect through an activation the contract accepts', () => {
    // Given: 목적지로 바로 보내면 비로그인 상태라 게이트가 랜딩으로 되튕긴다.
    const plan = call('anonymous', 'GET', 'auth/github');
    if (plan.kind !== 'redirect') throw new Error('expected a redirect plan');
    const url = new URL(plan.location, 'http://localhost:3000');

    // When: 활성화 경로가 실제로 페르소나를 켜고 그 화면으로 이어 주는지 본다.
    const activation = createLocalReviewActivation({
      nodeEnv: 'development',
      enabled: '1',
      backendOrigin: 'http://localhost:4000',
      requestHostname: 'localhost',
      fixtureParam: url.pathname.split('/').at(-1) ?? '',
      targetParam: url.searchParams.get('to'),
    });

    // Then: 미배정 페르소나로 켜지고 목적지는 역할 선택 화면이다.
    // target이 계약에서 걸리면 `/`로 떨어져 검토자가 랜딩으로 되돌아온다.
    expect(activation).toEqual({
      kind: 'redirect',
      fixture: 'unassigned',
      target: '/onboarding/role?notice=local-review-login',
    });
  });

  it('leaves the logout fixture as a plain JSON confirmation', () => {
    // Given / When: 로그아웃은 fetch로 부르므로 이동으로 바꾸면 안 된다.
    const plan = call('student', 'POST', 'auth/logout');

    // Then
    expect(plan.kind).toBe('json');
  });

  it('saves the settings screen edits instead of failing the submit', () => {
    // Given / When
    const profile = jsonBody(call('settings', 'PATCH', 'users/me/profile'));
    const notification = jsonBody(
      call('settings', 'PATCH', 'users/me/notification-email'),
    );

    // Then: 프로필 파서는 isComplete와 값의 정합성이 맞아야 통과시킨다.
    expect(profile).toEqual({
      name: '합성 설정 사용자',
      studentId: '260001',
      department: '인공지능학부',
      isComplete: true,
    });
    expect(notification).toEqual({
      notificationEmail: 'fixture@example.com',
      notifyEnabled: true,
    });
  });

  it('설정 화면의 저장은 입력한 값을 그대로 돌려준다', () => {
    // Given / When: 설정 화면은 학번을 뺀 `{ name, department }`를 보낸다.
    const profile = jsonBody(
      callWithBody('settings', 'PATCH', 'users/me/profile', {
        name: '합성 변경 이름',
        department: '빅데이터융합학과',
      }),
    );
    const notification = jsonBody(
      callWithBody('settings', 'PATCH', 'users/me/notification-email', {
        notificationEmail: 'changed@example.com',
        notifyEnabled: false,
      }),
    );

    // Then: 안 보낸 학번은 픽스처 값을 유지하고 isComplete는 그에 맞게 계산된다.
    expect(profile).toEqual({
      name: '합성 변경 이름',
      studentId: '260001',
      department: '빅데이터융합학과',
      isComplete: true,
    });
    expect(notification).toEqual({
      notificationEmail: 'changed@example.com',
      notifyEnabled: false,
    });
  });

  it('온보딩 프로필 저장은 미완성 입력을 미완성으로 답한다', () => {
    // Given / When: 파서는 isComplete와 값의 정합성이 어긋나면 응답을 거부한다.
    const profile = jsonBody(
      callWithBody('unassigned', 'PATCH', 'users/me/profile', {
        name: '합성 온보딩 사용자',
        studentId: '12',
        department: '인공지능학부',
      }),
    );

    // Then
    expect(profile).toEqual({
      name: '합성 온보딩 사용자',
      studentId: '12',
      department: '인공지능학부',
      isComplete: false,
    });
  });

  it('역할 선택은 고른 역할에 맞는 이동 경로를 준다', () => {
    // Given / When
    const student = jsonBody(
      callWithBody('unassigned', 'POST', 'onboarding/role', {
        selectedRole: 'STUDENT',
      }),
    );
    const staff = jsonBody(
      callWithBody('unassigned', 'POST', 'onboarding/role', {
        selectedRole: 'STAFF',
      }),
    );

    // Then: 교직원은 즉시 확정되지 않고 승인 대기 화면으로 간다.
    expect(student).toEqual({
      selectedRole: 'STUDENT',
      role: 'STUDENT',
      requestStatus: null,
      redirectTo: '/dashboard',
    });
    expect(staff).toEqual({
      selectedRole: 'STAFF',
      role: null,
      requestStatus: 'PENDING',
      redirectTo: '/onboarding/pending',
    });
  });

  it('lets the unassigned reviewer finish role onboarding', () => {
    // Given / When
    const selection = jsonBody(call('unassigned', 'POST', 'onboarding/role'));
    const staffRequest = jsonBody(call('unassigned', 'POST', 'role-requests'));

    // Then: 화면은 redirectTo만 사용하므로 앱 내부 경로여야 한다.
    expect(selection).toMatchObject({ redirectTo: '/dashboard' });
    expect(staffRequest).toMatchObject({
      requestedRole: 'STAFF',
      status: 'PENDING',
    });
  });

  it('leaves the loading and error personas to the global fixture rules', () => {
    // Given / When
    const loading = call('loading', 'GET', 'repositories/me');
    const error = call('error', 'POST', 'auth/logout');

    // Then
    expect(loading).toEqual({ kind: 'delay', milliseconds: 60_000 });
    expect(error).toMatchObject({ kind: 'json', status: 503 });
  });
});
