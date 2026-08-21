import { describe, expect, it } from 'vitest';
import { resetLocalReviewFixtureState } from '../fixture-response';
import { resetLocalReviewRoleSelection } from './account-handlers';
import { call, callWithBody, jsonBody } from './account-handlers-test-support';

describe('account onboarding completion fixtures', () => {
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
    callWithBody('unassigned', 'POST', 'users/me/profile', {
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
    callWithBody('unassigned', 'POST', 'users/me/profile', {
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
    callWithBody('unassigned', 'POST', 'users/me/profile', {
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
      callWithBody('unassigned', 'POST', 'users/me/profile', {
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
      callWithBody('unassigned', 'POST', 'users/me/profile', {
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
