import { describe, expect, it, vi } from 'vitest';
import { parsePublicProfile } from '@/features/profile/public-profile-api';
import { parseMyRepositoriesResponse } from '@/features/repositories/parser';
import type { RoleRequestStatus } from '@/features/roles/types';
import { onboardingPathFor } from '../../_shell/onboarding-route';
import type { AppRole } from '../../_shell/role';
import { profileOnboardingView } from '../../onboarding/profile/profile-onboarding-route';
import {
  createLocalReviewActivation,
  type LocalReviewFixtureId,
} from '../fixture-contract';
import {
  resetLocalReviewFixtureState,
  resolveLocalReviewResponse,
} from '../fixture-response';
import { resetLocalReviewRoleSelection } from './account-handlers';

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

/**
 * 백엔드 `consents/domain/consent-policy.ts`의 정책 버전. 문서 파일 이름이 곧 이
 * 버전이라 어긋나면 "전문 보기"가 404가 된다.
 */
const CONSENT_POLICY_VERSION = '2026-08-04';

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

  it('역할 선택은 고른 사실만 답하고 확정 결과를 싣지 않는다', () => {
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

    // Then: 두 역할의 답이 완전히 같다. 이 화면은 아무것도 확정하지 않으므로(#569)
    // 알려 줄 확정 결과가 없다. 백엔드
    // `roles/dto/role-selection-response.dto.ts`가 싣는 칸과 정확히 같아야 한다 —
    // 픽스처에만 남은 칸은 실배포에 없는 값을 화면이 읽게 만든다.
    expect(student).toEqual({
      selectedRole: 'STUDENT',
      redirectTo: '/onboarding/profile',
    });
    expect(staff).toEqual({
      selectedRole: 'STAFF',
      redirectTo: '/onboarding/profile',
    });
  });

  it('지금 고른 역할을 되돌려 준다 — 고르기 전이면 null을 본문에 싣는다', () => {
    // Given
    resetLocalReviewFixtureState();

    // Then: 빈 응답이 아니라 `{ selectedRole: null }`이다. 백엔드도 같은 모양을
    // 주고, 응답 본문이 비면 화면의 파서가 그것을 실패로 읽는다(PR #531).
    expect(jsonBody(call('unassigned', 'GET', 'onboarding/role'))).toEqual({
      selectedRole: null,
    });

    // When
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STAFF',
    });

    // Then
    expect(jsonBody(call('unassigned', 'GET', 'onboarding/role'))).toEqual({
      selectedRole: 'STAFF',
    });
  });

  /**
   * 반려 상태를 눈으로 볼 수 있는 페르소나(#673).
   *
   * 이 픽스처가 없어서 검토자가 반려 상태에 서 볼 수 없었다 — 역할 요청 픽스처가
   * `PENDING` 하나뿐이었다. 사유가 신청자 눈에 닿는지 확인할 자리가 검토판에도
   * 없었던 것이 이 결함이 오래 살아남은 이유 중 하나다.
   */
  it('반려 페르소나는 사유가 붙은 REJECTED 요청을 답한다', () => {
    // Given / When
    const body = jsonBody(call('role-rejected', 'GET', 'role-requests/me')) as {
      readonly status: string;
      readonly rejectionReason: string;
      readonly decidedAt: string;
    };

    // Then: 상태와 사유가 함께 있어야 화면이 안내를 세운다.
    expect(body.status).toBe('REJECTED');
    expect(body.rejectionReason.trim().length).toBeGreaterThan(0);
    // 판정 시각 없이 반려만 있는 응답은 실물에 없다.
    expect(Number.isFinite(Date.parse(body.decidedAt))).toBe(true);
  });

  /**
   * 도착지를 픽스처 응답에서 직접 파생시킨다 — 여기서 같은 판단을 다시 적으면
   * 잠그는 대상이 화면이 아니라 이 테스트 자신이 된다.
   */
  it('반려 페르소나의 다음 화면은 역할 선택이다', () => {
    // Given
    const roleRequest = jsonBody(
      call('role-rejected', 'GET', 'role-requests/me'),
    ) as { readonly status: RoleRequestStatus };
    const profile = jsonBody(
      call('role-rejected', 'GET', 'users/me/profile'),
    ) as { readonly isComplete: boolean };

    // When
    const path = onboardingPathFor(
      roleRequest.status,
      profile.isComplete ? 'complete' : 'incomplete',
    );

    // Then: 그 화면이 반려 안내를 세우는 자리다(#535 · #673).
    expect(path).toBe('/onboarding/role');
  });

  it('반려 페르소나는 약관 단계에서 멈추지 않는다', () => {
    // Given / When: 동의 전으로 답하면 진입 버튼이 1단계에서 멈춰, 정작 볼 화면에
    // 아무도 도달하지 못한다 — `role-pending`과 같은 이유다.
    const body = jsonBody(call('role-rejected', 'GET', 'consents/current'));

    // Then
    expect(body).toMatchObject({ consented: true });
  });

  /**
   * 반려는 "고른 역할"로 세지 않는다 — 마이그레이션이 반려·회수를 backfill에서
   * 명시적으로 제외했다. 실물에서 옛 반려 건이 보이는 모습과 같아야 한다.
   */
  it('반려 페르소나는 고른 역할을 남기지 않는다', () => {
    expect(jsonBody(call('role-rejected', 'GET', 'onboarding/role'))).toEqual({
      selectedRole: null,
    });
  });

  it('승인 대기 페르소나는 반려로 바뀌지 않는다', () => {
    // Given / When: 두 페르소나가 서로를 덮으면 한쪽 화면을 볼 수 없게 된다.
    const body = jsonBody(call('role-pending', 'GET', 'role-requests/me')) as {
      readonly status: string;
      readonly rejectionReason: string | null;
    };

    // Then
    expect(body.status).toBe('PENDING');
    expect(body.rejectionReason).toBe(null);
  });

  it('승인 대기 교직원 페르소나도 고른 역할을 교직원으로 답한다', () => {
    // 실물은 마이그레이션에서 살아 있는 요청을 보고 STAFF를 backfill한다.
    expect(jsonBody(call('role-pending', 'GET', 'onboarding/role'))).toEqual({
      selectedRole: 'STAFF',
    });
  });

  it('lets the unassigned reviewer finish role onboarding', () => {
    // Given / When
    const selection = jsonBody(call('unassigned', 'POST', 'onboarding/role'));
    const staffRequest = jsonBody(call('unassigned', 'POST', 'role-requests'));

    // Then: 화면은 redirectTo만 사용하므로 앱 내부 경로여야 한다.
    expect(selection).toMatchObject({ redirectTo: '/onboarding/profile' });
    expect(staffRequest).toMatchObject({
      requestedRole: 'STAFF',
      status: 'PENDING',
    });
  });

  /**
   * #569 회귀 검사 ① — 픽스처도 고르는 자리에서는 확정하지 않는다.
   *
   * 예전에는 학생을 고르는 즉시 세션 역할을 STUDENT로 바꿨다. 실물이 그랬기
   * 때문이다. 확정이 `가입 마치기`로 옮겨 간 지금 같은 값을 주면, 검토에서는
   * 프로필을 건너뛰고 대시보드에 들어갈 수 있는데 실배포에서는 막힌다.
   */
  it.each(['STUDENT', 'STAFF'] as const)(
    '%s을 고르기만 해서는 세션 역할도 승인 요청도 생기지 않는다',
    (selectedRole) => {
      // Given
      resetLocalReviewFixtureState();

      // When
      callWithBody('unassigned', 'POST', 'onboarding/role', { selectedRole });

      // Then
      expect(jsonBody(call('unassigned', 'GET', 'auth/session'))).toMatchObject(
        { isAuthenticated: true, user: { role: null } },
      );
      expect(
        jsonBody(call('unassigned', 'GET', 'role-requests/me')),
      ).toBeNull();
    },
  );

  /** #569 회귀 검사 ② — 픽스처도 `가입 마치기`에서 확정한다. */
  it('학생은 프로필을 마쳐야 세션 역할이 확정된다', () => {
    // Given
    resetLocalReviewFixtureState();
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STUDENT',
    });

    // When
    callWithBody('unassigned', 'PATCH', 'users/me/profile', {
      name: '합성 학생 사용자',
      studentId: '260001',
      department: '인공지능학부',
    });

    // Then
    expect(jsonBody(call('unassigned', 'GET', 'auth/session'))).toMatchObject({
      isAuthenticated: true,
      user: { role: 'STUDENT', isProfileComplete: true },
    });
  });

  it('교직원은 프로필을 마쳐야 승인 요청이 생기고, 역할은 승인 전까지 비어 있다', () => {
    // Given
    resetLocalReviewFixtureState();
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STAFF',
    });

    // When
    callWithBody('unassigned', 'PATCH', 'users/me/profile', {
      name: '합성 교직원 사용자',
      department: '인공지능학부',
    });

    // Then: 세션의 `isProfileComplete`는 **배정된 역할 기준**이라 역할이 없는
    // 동안에는 학생 기준으로 계산된다 — 학번이 없는 교직원은 여기서 미완료다.
    // 실물(`auth.repository.ts`)이 그렇게 답하므로 픽스처도 같아야 한다.
    expect(jsonBody(call('unassigned', 'GET', 'auth/session'))).toMatchObject({
      user: { role: null, isProfileComplete: false },
    });
    expect(
      jsonBody(call('unassigned', 'GET', 'role-requests/me')),
    ).toMatchObject({ requestedRole: 'STAFF', status: 'PENDING' });
  });

  // 검토판 링크를 다시 누르는 것이 곧 "처음부터 다시"여야 한다. 지우지 않으면 한 번
  // 걸어 본 가입 동선을 서버를 다시 띄우기 전에는 볼 수 없다.
  it('페르소나를 다시 켜면 앞선 검토의 역할 선택이 지워진다', () => {
    // Given: 교직원을 골라 프로필까지 마쳐 둔 상태.
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STAFF',
    });
    callWithBody('unassigned', 'PATCH', 'users/me/profile', {
      name: '합성 교직원 사용자',
      department: '인공지능학부',
    });

    // When: 활성화 경로가 하는 일과 같은 초기화.
    resetLocalReviewRoleSelection();

    // Then: 역할 선택 화면이 다시 첫 화면이 된다.
    expect(jsonBody(call('unassigned', 'GET', 'role-requests/me'))).toBeNull();
    expect(jsonBody(call('unassigned', 'GET', 'onboarding/role'))).toEqual({
      selectedRole: null,
    });
    expect(jsonBody(call('unassigned', 'GET', 'auth/session'))).toMatchObject({
      user: { role: null },
    });
  });

  it('교직원 프로필은 학번 없이도 완료로 답한다', () => {
    // Given: 교직원을 고른 사람의 프로필 화면은 학번 칸 자체를 열지 않는다.
    resetLocalReviewFixtureState();
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STAFF',
    });

    // When
    const profile = jsonBody(
      callWithBody('unassigned', 'PATCH', 'users/me/profile', {
        name: '합성 교직원 사용자',
        department: '인공지능학부',
      }),
    );

    // Then: 여기서 학번을 요구하면 화면은 묻지도 않는데 저장만 안 되는 모순이 된다.
    expect(profile).toEqual({
      name: '합성 교직원 사용자',
      studentId: null,
      department: '인공지능학부',
      isComplete: true,
    });
  });

  // 학번을 요구하지 않는 역할이라도 실려 온 값의 형식은 맞아야 한다. 형식이 깨진
  // 학번을 완료로 답하면 응답 파서가 그 모순을 잡아 응답 자체를 거부하고, 검토자는
  // 원인을 알 수 없는 "저장 실패"만 본다.
  it('교직원이라도 형식이 깨진 학번이 실려 오면 완료로 답하지 않는다', () => {
    // Given
    resetLocalReviewFixtureState();
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STAFF',
    });

    // When
    const profile = jsonBody(
      callWithBody('unassigned', 'PATCH', 'users/me/profile', {
        name: '합성 교직원 사용자',
        studentId: '12',
        department: '인공지능학부',
      }),
    );

    // Then
    expect(profile).toMatchObject({ studentId: '12', isComplete: false });
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

/**
 * 검토자가 실제로 걷는 가입 동선을 통째로 잠근다.
 *
 * 화면이 다음 단계를 어디로 정하는지는 `_shell/onboarding-route.ts`의
 * `onboardingPathFor`가 결정한다. 그 함수에 픽스처 응답을 그대로 먹여 동선을
 * 따라가는 이유는, 여기서 같은 판단을 다시 적으면 잠그는 대상이 화면이 아니라
 * 이 테스트 자신이 되기 때문이다.
 */
describe('가입 동선 — 약관 → 교직원 선택 → 프로필 → 승인 대기', () => {
  /** 지금 이 검토자가 있어야 할 온보딩 화면. 게이트가 읽는 두 값에서 파생시킨다. */
  function currentOnboardingPath(): string | null {
    const roleRequest = jsonBody(
      call('unassigned', 'GET', 'role-requests/me'),
    ) as { readonly status: RoleRequestStatus } | null;
    const profile = jsonBody(call('unassigned', 'GET', 'users/me/profile')) as {
      readonly isComplete: boolean;
    };
    return onboardingPathFor(
      roleRequest?.status ?? null,
      profile.isComplete ? 'complete' : 'incomplete',
    );
  }

  /**
   * 프로필 화면이 이 검토자에게 무엇을 할지. 그 화면은 `OnboardingGate`가 아니라
   * `ProfileOnboardingRoute`가 지키므로(#569 이후로는 고른 역할까지 봐야 한다) 판단도
   * 그 함수에게 그대로 물어본다 — 여기서 같은 판단을 다시 적으면 잠그는 대상이 화면이
   * 아니라 이 테스트 자신이 된다.
   */
  function currentProfileView() {
    const roleRequest = jsonBody(
      call('unassigned', 'GET', 'role-requests/me'),
    ) as { readonly status: RoleRequestStatus } | null;
    const selection = jsonBody(
      call('unassigned', 'GET', 'onboarding/role'),
    ) as {
      readonly selectedRole: 'STUDENT' | 'STAFF' | null;
    };
    const session = jsonBody(call('unassigned', 'GET', 'auth/session')) as {
      readonly user: { readonly role: AppRole | null };
    };
    return profileOnboardingView({
      status: session.user.role ? 'assigned' : 'unassigned',
      role: session.user.role,
      roleRequestStatus: roleRequest?.status ?? null,
      selectedRole: selection.selectedRole,
      isProfileComplete: false,
    });
  }

  it('교직원을 고른 검토자가 프로필을 거쳐 승인 대기 화면까지 도착한다', () => {
    // Given: 검토판 링크(`/local-review/unassigned?to=/consent`)를 막 누른 상태.
    resetLocalReviewFixtureState();

    // When / Then 1 — 약관. 아직 동의 전이라 화면이 떠야 하고, 다음은 역할 선택이다.
    expect(
      jsonBody(call('unassigned', 'GET', 'consents/current')),
    ).toMatchObject({ consented: false, nextUrl: '/onboarding/role' });
    expect(jsonBody(call('unassigned', 'POST', 'consents'))).toMatchObject({
      nextUrl: '/onboarding/role',
    });

    // 2 — 교직원 선택. 고른 사실만 남고, 남은 단계인 프로필로 바로 보낸다.
    const selection = jsonBody(
      callWithBody('unassigned', 'POST', 'onboarding/role', {
        selectedRole: 'STAFF',
      }),
    ) as { readonly redirectTo: string };
    expect(selection).toMatchObject({
      selectedRole: 'STAFF',
      redirectTo: '/onboarding/profile',
    });
    // 2-1 — 관리자 대기줄에 미완성 신청이 올라가지 않는다(#569). 프로필을 한 글자도
    //       입력하기 전이라 이름·학과가 비어 있다.
    expect(jsonBody(call('unassigned', 'GET', 'role-requests/me'))).toBeNull();

    // 3 — 왕복이 없어야 한다. 역할 선택이 준 목적지에 도착했을 때 그 화면이 폼을
    //     열어 줘야 제자리를 돌지 않는다. 여기서 고른 역할이 잊히면 그 화면이
    //     랜딩으로 되돌리고, 검토자는 가입을 마칠 방법이 없다.
    //
    //     이 화면의 게이트는 `OnboardingGate`가 아니라 `ProfileOnboardingRoute`다.
    //     아직 확정된 것이 없어 `onboardingPathFor`는 `/onboarding/role`을 가리키는데
    //     (되돌아갈 수 있어야 하므로 그것이 맞다) 그 값은 이 화면을 막지 않는다.
    expect(selection.redirectTo).toBe('/onboarding/profile');
    expect(currentProfileView()).toMatchObject({
      kind: 'form',
      // 교직원이라 학번을 묻지 않는다.
      role: 'STAFF',
      nextPath: '/onboarding/pending',
      // 확정 전이라 역할 선택으로 되돌아갈 수 있다.
      canChangeRole: true,
    });

    // 4 — 프로필 저장. 교직원이라 학번은 묻지 않는다.
    expect(
      jsonBody(
        callWithBody('unassigned', 'PATCH', 'users/me/profile', {
          name: '합성 교직원 사용자',
          department: '인공지능학부',
        }),
      ),
    ).toMatchObject({ isComplete: true });

    // 5 — 저장 뒤 다시 게이트. 이번엔 승인 대기 화면이 목적지다. 승인 요청은 바로
    //     이 저장에서 생긴다(#569). 세션 역할은 승인 전이라 계속 비어 있어야
    //     온보딩 밖(역할 홈)으로 튕기지 않는다.
    expect(
      jsonBody(call('unassigned', 'GET', 'role-requests/me')),
    ).toMatchObject({ requestedRole: 'STAFF', status: 'PENDING' });
    expect(currentOnboardingPath()).toBe('/onboarding/pending');
    expect(jsonBody(call('unassigned', 'GET', 'auth/session'))).toMatchObject({
      isAuthenticated: true,
      user: { role: null },
    });
  });

  /**
   * 검토가 실제로 깨진 자리. Next 개발 서버는 화면을 처음 열 때 그 라우트를
   * 컴파일하면서 서버 모듈을 새로 평가하고, 모듈 최상단 `let`에 담아 둔 값은 그때
   * 초기값으로 돌아간다. `vi.resetModules()` + 동적 import 가 그 재평가와 같은 일을
   * 한다 — 이 잠금이 없으면 "요청 사이에 남는다"까지만 확인하게 되고, 정작 검토가
   * 깨지는 조건(라우트 첫 컴파일)은 아무도 지키지 않는다.
   */
  it('라우트가 처음 컴파일돼 모듈이 다시 평가돼도 가입 도중 상태가 남는다', async () => {
    // Given: 교직원을 고르고 프로필까지 저장한 상태.
    resetLocalReviewFixtureState();
    callWithBody('unassigned', 'POST', 'onboarding/role', {
      selectedRole: 'STAFF',
    });
    callWithBody('unassigned', 'PATCH', 'users/me/profile', {
      name: '합성 교직원 사용자',
      department: '인공지능학부',
    });

    // When: `/onboarding/pending`을 처음 여는 순간과 같은 모듈 재평가.
    vi.resetModules();
    const reloaded = await import('../fixture-response');
    const readAfterReload = (path: string) =>
      reloaded.resolveLocalReviewResponse({
        fixture: 'unassigned',
        method: 'GET',
        path,
        searchParams: new URLSearchParams(),
      });

    // Then: 역할 요청이 `null`로 바뀌면 대기 화면이 역할 선택으로 되튕겨,
    // 검토자는 방금 고른 교직원이 안 골라진 것으로 본다.
    expect(jsonBody(readAfterReload('role-requests/me'))).toMatchObject({
      requestedRole: 'STAFF',
      status: 'PENDING',
    });
    expect(jsonBody(readAfterReload('users/me/profile'))).toMatchObject({
      isComplete: true,
    });
  });
});
