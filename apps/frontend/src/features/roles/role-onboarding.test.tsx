import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { REJECTION_REASON_MAX_LENGTH } from '@/lib/display-text';
import {
  RoleSelectionForm,
  type ClosedStaffAccessRequestNotice,
} from './components/role-selection-screen';
import {
  ROLE_REQUEST_RETRY_FAILURE_MESSAGE,
  StaffAccessRequestStatusView,
} from './components/role-request-screen';
import type { StaffAccessRequest } from './types';

const noOp = () => undefined;

function renderRoleForm(
  selectedRole: 'STUDENT' | 'STAFF' | null,
  rejection: ClosedStaffAccessRequestNotice | null = null,
): string {
  return renderToStaticMarkup(
    <RoleSelectionForm
      selectedRole={selectedRole}
      isSubmitting={false}
      errorMessage={null}
      rejection={rejection}
      onSelect={noOp}
      onSubmit={noOp}
    />,
  );
}

function rejectionNotice(
  reason: string | null,
): ClosedStaffAccessRequestNotice {
  return { status: 'REJECTED', reason };
}

function staffAccessRequest(
  overrides: Partial<StaffAccessRequest> = {},
): StaffAccessRequest {
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
    const html = renderRoleForm('STAFF');

    expect(html).toContain('data-role="STAFF"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('관리자 승인이 필요합니다');
    expect(html).toContain('선택 완료');
  });

  it('역할을 고르기 전에는 다음 단계 안내를 그리지 않는다', () => {
    const emptyHtml = renderRoleForm(null);

    expect(emptyHtml).not.toContain('다음 단계 안내');
    expect(emptyHtml).not.toContain('data-role="none"');
    expect(emptyHtml).not.toContain('기본 정보를 입력하면 가입이 끝납니다');
    expect(emptyHtml).not.toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  it.each([
    ['STUDENT', '이름·학번·학과를 입력하는 화면으로 이동합니다'],
    ['STAFF', '이름·학과를 입력하는 화면으로 이동합니다'],
  ] as const)(
    '%s 안내는 다음 화면이 프로필 입력임을 말한다',
    (role, phrase) => {
      const html = renderRoleForm(role);

      expect(html).toContain(phrase);
      expect(html).not.toContain('바로 학생 화면으로 이동합니다');
      expect(html).not.toContain('승인 상태를 확인할 수 있는 화면으로');
    },
  );

  it('교직원 안내는 프로필 다음이 승인 대기임을 함께 말한다', () => {
    const html = renderRoleForm('STAFF');

    expect(html).toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  it('안내 자리는 선택 전에도 같은 슬롯으로 확보한다', () => {
    const emptyHtml = renderRoleForm(null);
    const staffHtml = renderRoleForm('STAFF');

    const slot = 'data-slot="role-guidance"';
    expect(emptyHtml).toContain(slot);
    expect(staffHtml).toContain(slot);
    expect(staffHtml).toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  it('두 역할 카드 모두 승인 여부 한 줄을 가진다', () => {
    const html = renderRoleForm(null);

    expect(html).toContain('학생 가입에는 승인이 필요하지 않습니다');
    expect(html).toContain('관리자 승인이 필요합니다');
  });

  it('반려 안내는 반려 사실과 사유 전문을 함께 그린다', () => {
    const html = renderRoleForm(
      null,
      rejectionNotice('학과 소속이 확인되지 않았습니다.'),
    );

    expect(html).toContain('data-slot="role-request-closed"');
    expect(html).toContain('data-status="REJECTED"');
    expect(html).toContain('교직원 요청이 반려되었습니다');
    expect(html).toContain('반려 사유');
    expect(html).toContain('학과 소속이 확인되지 않았습니다.');

    expect(html).toContain('선택 완료');
    expect(html).not.toContain('다시 승인 요청하기');
  });

  it.each([
    ['null 사유', null],
    ['공백뿐인 사유', '   \n  '],
  ] as readonly (readonly [string, string | null])[])(
    '%s는 사실과 안내만 남기고 빈 사유 상자를 그리지 않는다',
    (_label, reason) => {
      const html = renderRoleForm(null, rejectionNotice(reason));

      expect(html).toContain('교직원 요청이 반려되었습니다');
      expect(html).toContain(
        '아래에서 교직원을 다시 고르면 승인 요청이 새로 접수됩니다.',
      );

      expect(html).not.toContain('반려 사유');
    },
  );

  it('안내 문구는 같은 말을 두 번 하지 않는다', () => {
    const html = renderRoleForm(null, rejectionNotice(null));

    expect(html).not.toMatch(
      /교직원을 다시 고르면 승인 요청이 한 번 더 접수됩니다/,
    );
    expect(html).not.toMatch(/아래에서 역할을 다시 고르면 새로 신청됩니다/);
  });

  it('아주 긴 사유는 잘라서 그린다', () => {
    const reason = '반'.repeat(REJECTION_REASON_MAX_LENGTH * 3);

    const html = renderRoleForm(null, rejectionNotice(reason));

    expect(html).not.toContain(reason);
    expect(html).toContain('반'.repeat(REJECTION_REASON_MAX_LENGTH));
    expect(html).toContain('…');

    expect(html).toContain('break-words');
    expect(html).toContain('whitespace-pre-wrap');
  });

  it('반려가 아닌 사용자의 화면에는 안내 자리가 아예 없다', () => {
    const html = renderRoleForm('STAFF');

    expect(html).not.toContain('data-slot="role-request-closed"');
    expect(html).not.toContain('교직원 요청이 반려되었습니다');
  });

  it.each([
    ['안내 없음', null],
    ['안내 있음', rejectionNotice('학과 소속이 확인되지 않았습니다.')],
  ] as readonly (readonly [string, ClosedStaffAccessRequestNotice | null])[])(
    '%s 상태 모두에서 두 역할 카드는 가로로 나란히 선다',
    (_label, rejection) => {
      const html = renderRoleForm(null, rejection);

      expect(html).toContain('grid grid-cols-2 items-stretch gap-3');
      expect(html).not.toMatch(/<fieldset[^>]*grid-cols-1/);
      expect(html).not.toMatch(/<fieldset[^>]*flex-col/);
    },
  );

  it('반려된 요청은 반려 사유와 재요청 동작을 표시한다', () => {
    const rejected = staffAccessRequest({
      status: 'REJECTED',
      decidedAt: '2026-07-21T01:00:00.000Z',
      rejectionReason: '합성 반려 사유',
    });

    const html = renderToStaticMarkup(
      <StaffAccessRequestStatusView
        request={rejected}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('data-status="REJECTED"');
    expect(html).toContain('합성 반려 사유');
    expect(html).toContain('다시 승인 요청하기');
  });

  it('승인 기록만 남은 요청도 같은 대기 안내에 서고 내부 불일치를 적지 않는다', () => {
    const approved = staffAccessRequest({
      status: 'APPROVED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    const html = renderToStaticMarkup(
      <StaffAccessRequestStatusView
        request={approved}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('data-status="APPROVED"');
    expect(html).toContain('교직원 승인을 기다리고 있습니다');
    expect(html).toContain('상태 새로고침');

    expect(html).not.toContain('권한이 없습니다');
    expect(html).not.toContain('권한 없음');
    expect(html).not.toContain('권한을 회수했거나');

    expect(html).not.toContain('href="/dashboard"');
  });

  it('승인 대기 요청은 이름·학과를 고치러 갈 길을 함께 낸다', () => {
    const pending = staffAccessRequest();

    const html = renderToStaticMarkup(
      <StaffAccessRequestStatusView
        request={pending}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('data-status="PENDING"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('이름·학과 고치기');
  });

  it('승인 대기 요청에 역할을 다시 고르는 길은 내지 않는다', () => {
    const pending = staffAccessRequest();

    const html = renderToStaticMarkup(
      <StaffAccessRequestStatusView
        request={pending}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    expect(html).not.toContain('href="/onboarding/role"');
    expect(html).not.toContain('href="/onboarding/profile"');
  });

  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 요청에는 설정으로 가는 길을 내지 않는다',
    (status) => {
      const request = staffAccessRequest({
        status,
        decidedAt: '2026-07-21T01:00:00.000Z',
      });

      const html = renderToStaticMarkup(
        <StaffAccessRequestStatusView
          request={request}
          isRetrying={false}
          errorMessage={null}
          onRefresh={noOp}
          onRetry={noOp}
        />,
      );

      expect(html).not.toContain('href="/settings"');
    },
  );

  it('회수된 요청 응답도 안전하게 역할 재선택 경로를 표시한다', () => {
    const revoked = staffAccessRequest({
      status: 'REVOKED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    const html = renderToStaticMarkup(
      <StaffAccessRequestStatusView
        request={revoked}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('data-status="REVOKED"');
    expect(html).toContain('href="/onboarding/role"');
  });

  it('재요청 실패 안내는 남은 상태와 다음에 누를 버튼을 함께 알린다', () => {
    const rejected = staffAccessRequest({
      status: 'REJECTED',
      decidedAt: '2026-07-21T01:00:00.000Z',
      rejectionReason: '합성 반려 사유',
    });

    const html = renderToStaticMarkup(
      <StaffAccessRequestStatusView
        request={rejected}
        isRetrying={false}
        errorMessage={ROLE_REQUEST_RETRY_FAILURE_MESSAGE}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    expect(html).toContain(ROLE_REQUEST_RETRY_FAILURE_MESSAGE);
    expect(html).toContain('다시 승인 요청하기');
    expect(html).toContain('상태 새로고침');

    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).not.toContain(
      '요청 상태는 반려 그대로',
    );
    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).toContain(
      '‘상태 새로고침’으로 지금 상태를 확인',
    );
    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).toContain(
      '‘다시 승인 요청하기’를 눌러 주세요',
    );
  });
});
