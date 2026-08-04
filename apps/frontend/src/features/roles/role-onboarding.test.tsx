import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RoleSelectionForm } from './components/role-selection-screen';
import {
  ROLE_REQUEST_RETRY_FAILURE_MESSAGE,
  RoleRequestStatusView,
} from './components/role-request-screen';
import type { RoleRequest } from './types';

const noOp = () => undefined;

function renderRoleForm(selectedRole: 'STUDENT' | 'STAFF' | null): string {
  return renderToStaticMarkup(
    <RoleSelectionForm
      selectedRole={selectedRole}
      isSubmitting={false}
      errorMessage={null}
      onSelect={noOp}
      onSubmit={noOp}
    />,
  );
}

function roleRequest(overrides: Partial<RoleRequest> = {}): RoleRequest {
  return {
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-21T00:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

describe('role onboarding views', () => {
  it('선택한 교직원 역할과 승인 필요 안내를 함께 표시한다', () => {
    // Given / When
    const html = renderRoleForm('STAFF');

    // Then
    expect(html).toContain('data-role="STAFF"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('관리자 승인이 필요합니다');
    expect(html).toContain('선택 완료');
  });

  // 아직 아무 정보도 없는 상자를 먼저 보여 주지 않는다 — 안내는 고른 뒤에 생긴다.
  it('역할을 고르기 전에는 다음 단계 안내를 그리지 않는다', () => {
    // Given / When
    const emptyHtml = renderRoleForm(null);

    // Then — 자리표시 상자도, 어느 역할의 안내 문구도 아직 없다
    expect(emptyHtml).not.toContain('다음 단계 안내');
    expect(emptyHtml).not.toContain('data-role="none"');
    expect(emptyHtml).not.toContain('기본 정보를 입력하면 가입이 끝납니다');
    expect(emptyHtml).not.toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  /**
   * 안내가 실제 도착지와 같은 곳을 말하는가.
   *
   * 백엔드 `roles.service.ts`는 두 역할 모두에게 `/onboarding/profile`을 돌려준다.
   * 그런데 이 안내는 학생에게 "바로 학생 화면으로", 교직원에게 "승인 상태를 확인할
   * 수 있는 화면으로" 간다고 말했다 — 둘 다 도착하지 않는 화면이다. 고른 직후 읽는
   * 문장이 도착지와 다르면 사용자는 화면이 잘못 떴다고 읽는다.
   */
  it.each([
    ['STUDENT', '이름·학번·학과를 입력하는 화면으로 이동합니다'],
    ['STAFF', '이름·학과를 입력하는 화면으로 이동합니다'],
  ] as const)(
    '%s 안내는 다음 화면이 프로필 입력임을 말한다',
    (role, phrase) => {
      // Given / When
      const html = renderRoleForm(role);

      // Then
      expect(html).toContain(phrase);
      expect(html).not.toContain('바로 학생 화면으로 이동합니다');
      expect(html).not.toContain('승인 상태를 확인할 수 있는 화면으로');
    },
  );

  // 교직원은 프로필을 마친 뒤에야 승인 대기 화면으로 이어진다 — 그 순서가 안내에
  // 드러나야 "승인은 어디서 기다리나"를 사용자가 다시 묻지 않는다.
  it('교직원 안내는 프로필 다음이 승인 대기임을 함께 말한다', () => {
    // Given / When
    const html = renderRoleForm('STAFF');

    // Then
    expect(html).toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  // 안내가 선택 시점에 새로 끼어들면 세로 가운데 정렬인 무대가 위아래로 벌어져
  // 방금 누른 카드까지 움직인다. 빈 자리를 미리 잡아 두었는지를 못박는다.
  it('안내 자리는 선택 전에도 같은 슬롯으로 확보한다', () => {
    // Given / When
    const emptyHtml = renderRoleForm(null);
    const staffHtml = renderRoleForm('STAFF');

    // Then
    const slot = 'data-slot="role-guidance"';
    expect(emptyHtml).toContain(slot);
    expect(staffHtml).toContain(slot);
    expect(staffHtml).toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  // 카드 높이는 서로 맞춰야 한다 — 한쪽에만 있는 줄이 생기면 어긋난다.
  it('두 역할 카드 모두 승인 여부 한 줄을 가진다', () => {
    // Given / When
    const html = renderRoleForm(null);

    // Then
    expect(html).toContain('승인 없이 바로 시작합니다');
    expect(html).toContain('관리자 승인이 필요합니다');
  });

  it('반려된 요청은 반려 사유와 재요청 동작을 표시한다', () => {
    // Given
    const rejected = roleRequest({
      status: 'REJECTED',
      decidedAt: '2026-07-21T01:00:00.000Z',
      rejectionReason: '합성 반려 사유',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={rejected}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="REJECTED"');
    expect(html).toContain('합성 반려 사유');
    expect(html).toContain('다시 승인 요청하기');
  });

  it('승인된 요청은 교직원 화면 이동 경로를 제공한다', () => {
    // Given
    const approved = roleRequest({
      status: 'APPROVED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={approved}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="APPROVED"');
    expect(html).toContain('href="/dashboard"');
  });

  /**
   * 승인을 기다리는 사람이 자기 이름을 고치러 갈 자리(#598).
   *
   * 고칠 화면은 이미 열려 있었지만(#581) 그리로 가는 길이 머리글 계정 메뉴 하나뿐이라,
   * 그 메뉴를 모르는 사람에게는 오타 하나가 영영 남았다.
   */
  it('승인 대기 요청은 이름·학과를 고치러 갈 길을 함께 낸다', () => {
    // Given
    const pending = roleRequest();

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={pending}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then — 상태 새로고침 하나만 있던 화면이다
    expect(html).toContain('data-status="PENDING"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('이름·학과 고치기');
  });

  /**
   * 역할 선택 단계는 여기서 열지 않는다.
   *
   * 승인 대기 중에 역할을 다시 고르면 요청이 하나 더 만들어져 관리자 승인 목록에
   * 같은 사람이 두 번 뜬다(역할 요청 생성이 프로필 저장과 분리돼 있다).
   */
  it('승인 대기 요청에 역할을 다시 고르는 길은 내지 않는다', () => {
    // Given
    const pending = roleRequest();

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={pending}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).not.toContain('href="/onboarding/role"');
    expect(html).not.toContain('href="/onboarding/profile"');
  });

  /**
   * 반려·회수는 설정 화면의 문이 닫혀 있다(`app/settings/settings-access.ts`).
   * 링크를 내면 눌러도 이 화면으로 되돌아오는 제자리 걸음이 된다.
   */
  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 요청에는 설정으로 가는 길을 내지 않는다',
    (status) => {
      // Given
      const request = roleRequest({
        status,
        decidedAt: '2026-07-21T01:00:00.000Z',
      });

      // When
      const html = renderToStaticMarkup(
        <RoleRequestStatusView
          request={request}
          isRetrying={false}
          errorMessage={null}
          onRefresh={noOp}
          onRetry={noOp}
        />,
      );

      // Then
      expect(html).not.toContain('href="/settings"');
    },
  );

  it('회수된 요청 응답도 안전하게 역할 재선택 경로를 표시한다', () => {
    // Given
    const revoked = roleRequest({
      status: 'REVOKED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={revoked}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="REVOKED"');
    expect(html).toContain('href="/onboarding/role"');
  });

  /**
   * 실패 안내는 "못 했다"로 끝나면 안 된다 — 요청이 어떤 상태로 남았는지와
   * 바로 아래 어떤 버튼을 누르면 되는지가 같은 문장 안에 있어야 한다.
   */
  it('재요청 실패 안내는 남은 상태와 다음에 누를 버튼을 함께 알린다', () => {
    // Given
    const rejected = roleRequest({
      status: 'REJECTED',
      decidedAt: '2026-07-21T01:00:00.000Z',
      rejectionReason: '합성 반려 사유',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={rejected}
        isRetrying={false}
        errorMessage={ROLE_REQUEST_RETRY_FAILURE_MESSAGE}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then — 안내가 가리키는 버튼이 같은 화면에 실제로 있다
    expect(html).toContain(ROLE_REQUEST_RETRY_FAILURE_MESSAGE);
    expect(html).toContain('다시 승인 요청하기');
    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).toContain(
      '요청 상태는 반려 그대로이니',
    );
    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).toContain(
      '‘다시 승인 요청하기’를 눌러 주세요',
    );
  });
});
