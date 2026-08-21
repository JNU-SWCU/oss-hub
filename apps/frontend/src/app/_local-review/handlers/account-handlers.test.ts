import { describe, expect, it } from 'vitest';
import { parsePublicProfile } from '@/features/profile/public-profile-api';
import { parseMyRepositoriesResponse } from '@/features/repositories/parser';
import { createLocalReviewActivation } from '../fixture-contract';
import {
  AUTHENTICATED_FIXTURES,
  CONSENT_POLICY_VERSION,
  call,
  callWithBody,
  jsonBody,
} from './account-handlers-test-support';

describe('account fixture responses', () => {
  it('serves a public profile that the real parser accepts', () => {
    // Given / When
    const body = jsonBody(
      call('anonymous', 'GET', 'users/synthetic-user-01/public-profile'),
    );

    // Then: 파서가 githubUrl·detailUrl·publishedAt 형식을 모두 검사한다.
    const profile = parsePublicProfile(body);
    expect(profile.githubNickname).toBe('synthetic-contributor-01');
    expect(profile.projects.map((item) => item.projectId)).toEqual([
      'synthetic-repo-capstone',
      'synthetic-repo-contest',
    ]);
    // 공개 아카이브 상세로 이어지는 경로가 끊기지 않아야 한다.
    expect(profile.projects[0]?.detailUrl).toBe(
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
    expect(parsePublicProfile(empty).projects).toEqual([]);
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
      expect(repositories.items.map((item) => item.provisionStatus)).toEqual([
        'SUCCEEDED',
        'SUCCEEDED',
        'PROCESSING',
        'FAILED_FINAL',
      ]);
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
      policyVersion: CONSENT_POLICY_VERSION,
      consented: false,
      nextUrl: '/onboarding/role',
    });
    expect((body as { requiredItems: unknown[] }).requiredItems).toHaveLength(
      3,
    );
  });

  // "전문 보기"가 열어야 할 문서는 `public/policies/`에 실제로 있는 파일이다.
  // 없는 주소를 주면 대화상자에 404가 뜨고, 검토자는 약관 내용을 못 본 채 동의한다.
  it('약관 전문 주소가 제품이 배포하는 실제 문서를 가리킨다', () => {
    // Given / When
    const body = jsonBody(call('unassigned', 'GET', 'consents/current')) as {
      requiredItems: readonly { key: string; documentUrl: string }[];
    };

    // Then: 키·주소 모두 백엔드 `CURRENT_CONSENT_POLICY`와 같은 값이다.
    expect(body.requiredItems.map((item) => item.key)).toEqual([
      'PRIVACY_COLLECTION',
      'GITHUB_ACTIVITY',
      'ORG_REPOSITORY_TERMS',
    ]);
    expect(body.requiredItems.map((item) => item.documentUrl)).toEqual([
      `/policies/privacy/${CONSENT_POLICY_VERSION}.html`,
      `/policies/github-activity/${CONSENT_POLICY_VERSION}.html`,
      `/policies/org-repository-terms/${CONSENT_POLICY_VERSION}.html`,
    ]);
  });

  it('lets the approval-waiting reviewer past the consent step', () => {
    // Given / When
    const body = jsonBody(call('role-pending', 'GET', 'consents/current'));

    // Then: 이미 동의를 마친 상태여야 랜딩 진입 버튼(`/consent`)이 1단계에서
    // 멈추지 않고 `/onboarding/pending`까지 이어진다.
    expect(body).toMatchObject({
      policyVersion: CONSENT_POLICY_VERSION,
      consented: true,
      nextUrl: '/onboarding/role',
    });
  });

  it('accepts the consent submission with the next onboarding step', () => {
    // Given / When
    const body = jsonBody(call('unassigned', 'POST', 'consents'));

    // Then
    expect(body).toMatchObject({
      policyVersion: CONSENT_POLICY_VERSION,
      nextUrl: '/onboarding/role',
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

  it('sends the login link to the consent screen instead of raw JSON', () => {
    // Given: 랜딩의 "GitHub으로 로그인"은 fetch가 아니라 링크로 전체 이동한다.
    // When
    const plan = call('anonymous', 'GET', 'auth/github');

    // Then: JSON이면 브라우저가 그 JSON을 그대로 렌더한다 — 이동이어야 한다.
    if (plan.kind !== 'redirect') throw new Error('expected a redirect plan');
    expect(plan.status).toBe(303);
    expect(plan.location).toBe(
      '/local-review/unassigned?to=%2Fconsent%3Fnotice%3Dlocal-review-login',
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

    // Then: 미배정 페르소나로 켜지고 목적지는 약관 동의 화면이다 — 실제
    // backend 의 로그인 후 진입점과 같아야 한다.
    // target이 계약에서 걸리면 `/`로 떨어져 검토자가 랜딩으로 되돌아온다.
    expect(activation).toEqual({
      kind: 'redirect',
      fixture: 'unassigned',
      target: '/consent?notice=local-review-login',
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
});
