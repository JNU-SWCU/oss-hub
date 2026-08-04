import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AdminAccessDetail } from './admin-access-api';
import { AdminAccessMutationActions } from './components/admin-access-mutation-actions';

const noOp = () => undefined;

const TWO_STEP_HINT =
  '관리자로 올리려면 먼저 교직원으로 올린 뒤 다시 관리자로 올려 주세요.';

function detail(overrides: Partial<AdminAccessDetail> = {}): AdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STUDENT',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

function markup(detailOverrides: Partial<AdminAccessDetail> = {}): string {
  return renderToStaticMarkup(
    <AdminAccessMutationActions
      detail={detail(detailOverrides)}
      processingAction={null}
      onRequestAction={noOp}
    />,
  );
}

/**
 * #576 재현 조건: 승격은 한 단계씩만 일어나므로(`GRANT_TARGET_BY_RANK`)
 * 학생을 고르면 부여 항목이 교직원만 가리킨다. 그 화면만 보고는 관리자까지
 * 두 번 올려야 한다는 것을 알 수 없었다. 사다리는 그대로 두고 문구만 더한다.
 */
describe('AdminAccessMutationActions — 관리자 승격 두 단계 안내 (#576)', () => {
  it('학생을 보고 있으면 관리자까지 두 단계임을 안내한다', () => {
    const html = markup({ role: 'STUDENT' });

    expect(html).toContain(TWO_STEP_HINT);
  });

  it('교직원을 보고 있으면 안내하지 않는다 — 한 번 부여하면 관리자다', () => {
    const html = markup({ role: 'STAFF' });

    expect(html).toContain('권한 직접 부여');
    expect(html).not.toContain(TWO_STEP_HINT);
    expect(html).not.toContain('data-slot="admin-access-two-step-admin-hint"');
  });

  it('관리자를 보고 있으면 안내하지 않는다 — 더 올라갈 등급이 없다', () => {
    const html = markup({ role: 'ADMIN' });

    expect(html).not.toContain(TWO_STEP_HINT);
  });

  it('아직 역할이 없는 사용자도 관리자까지 두 번 남았으므로 함께 안내한다', () => {
    const html = markup({ role: null });

    expect(html).toContain(TWO_STEP_HINT);
  });

  // 대기 중인 요청이 있으면 결정(승인/반려)이 먼저라 부여 항목 자체가 없다.
  // 이때 안내를 띄우면 화면에 없는 버튼을 가리키게 된다.
  it('대기 중인 요청이 있어 부여 항목이 없으면 학생이어도 안내하지 않는다', () => {
    const html = markup({
      role: 'STUDENT',
      pendingRequest: {
        id: 'req-1',
        status: 'PENDING',
        createdAt: '2026-07-30T00:00:00.000Z',
      },
    });

    expect(html).not.toContain('권한 직접 부여');
    expect(html).not.toContain(TWO_STEP_HINT);
  });

  it('안내가 보일 때 작업 드롭다운이 그 문구를 설명으로 참조한다', () => {
    const html = markup({ role: 'STUDENT' });

    expect(html).toContain(
      'aria-describedby="admin-access-two-step-admin-hint"',
    );
    expect(html).toContain('id="admin-access-two-step-admin-hint"');
  });
});
