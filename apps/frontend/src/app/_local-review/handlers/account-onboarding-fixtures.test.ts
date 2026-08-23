import { describe, expect, it } from 'vitest';
import type { StaffAccessRequestStatus } from '@/features/roles/types';
import { onboardingPathFor } from '../../_shell/onboarding-route';
import { resetLocalReviewFixtureState } from '../fixture-response';
import { call, callWithBody, jsonBody } from './account-handlers-test-support';

describe('account onboarding fixture responses', () => {
  it('온보딩 프로필 저장은 미완성 입력을 미완성으로 답한다', () => {
    // Given / When: 파서는 isComplete와 값의 정합성이 어긋나면 응답을 거부한다.
    const profile = jsonBody(
      callWithBody('unassigned', 'POST', 'users/me/profile', {
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
    const staffAccessRequest = jsonBody(
      call('role-rejected', 'GET', 'role-requests/me'),
    ) as { readonly status: StaffAccessRequestStatus };
    const profile = jsonBody(
      call('role-rejected', 'GET', 'users/me/profile'),
    ) as { readonly isComplete: boolean };

    // When
    const path = onboardingPathFor(
      staffAccessRequest.status,
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
});
