import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogView } from './audit-log-view';

const baseProps = {
  filters: { actor: '', action: '', from: '', to: '' },
  page: 1,
  limit: 20,
  total: 0,
  onFilterChange: vi.fn(),
  onSearch: vi.fn(),
  onReset: vi.fn(),
  onPageChange: vi.fn(),
  onRetry: vi.fn(),
};

function isButtonDisabled(html: string, label: string): boolean {
  const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
  if (button === undefined) {
    throw new Error(`"${label}" 버튼을 찾지 못했습니다.`);
  }
  // shadcn Button의 className에 `disabled:` 변형이 들어 있으므로 속성만 본다.
  return / disabled=""/.test(button);
}

describe('AuditLogView', () => {
  it('로딩 스켈레톤을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading
        errorMessage={null}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('감사 로그를 불러오는 중');
  });

  it('기록이 없으면 빈 상태를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('기록이 없습니다');
  });

  it('조회 조건 설명을 제공한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain(
      '역할 요청 변경 이력을 행위자, 액션, 기간으로 조회합니다.',
    );
  });

  it('조회 실패와 다시 시도 동작을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage="감사 로그를 불러오지 못했습니다."
      />,
    );

    expect(html).toContain('감사 로그를 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
  });

  it('행마다 서술문·발생 일시·상대 시각을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-1',
            actor: 'synthetic-admin',
            action: 'STAFF_ROLE_REQUEST_APPROVED',
            targetType: 'ROLE_REQUEST',
            targetId: 'request-1',
            target: 'synthetic-target',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    // 서술문: 행위자·대상이 강조되고, target이 GitHub 로그인 형태라 '@' 접두가 붙는다.
    expect(html).toContain('synthetic-admin');
    expect(html).toContain('@synthetic-target');
    expect(html).toContain('님의 교직원 권한 요청을 승인했습니다');
    // 2행: action 배지 + 한국어 targetType + target 라벨. 이 target(핸들)이 이미
    // 풀린 값이라(isFallbackTarget이 false) 메타 라인도 targetId cuid 대신 그 라벨을
    // 보여준다 — 서술문과 같은 값이 두 번 다른 모양(핸들 vs cuid)으로 겹치지 않는다.
    expect(html).toContain('data-variant="approved"');
    expect(html).toContain('승인');
    expect(html).toContain('권한 요청');
    expect(html).toContain('synthetic-target');
    expect(html).not.toContain('request-1');
    // 발생 일시: 절대 시각은 항상 표시하고 <time dateTime>을 유지한다.
    expect(html).toContain('<time dateTime="2026-07-24T03:00:00.000Z"');
  });

  it('target이 legacy 폴백 라벨이면 서술문에서 코드체로 표시하고 @를 붙이지 않는다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-legacy',
            actor: 'synthetic-admin',
            action: 'STAFF_ROLE_REQUEST_APPROVED',
            targetType: 'ROLE_REQUEST',
            targetId: 'request-legacy',
            target: 'ROLE_REQUEST / request-legacy',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('<code');
    expect(html).toContain('권한 요청');
    expect(html).toContain('request-legacy');
    expect(html).not.toContain('@request-legacy');
    // '님' 존칭이 코드체 폴백 값 뒤에 붙지 않는다(리뷰 지적 수정).
    expect(html).not.toContain('request-legacy님');
  });

  it('REPOSITORY_PUBLISHED 행도 서술문과 targetType 한국어 라벨로 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-repository-published',
            actor: 'synthetic-staff',
            action: 'REPOSITORY_PUBLISHED',
            targetType: 'REPOSITORY',
            targetId: 'repository-synthetic-1',
            target: 'REPOSITORY / repository-synthetic-1',
            occurredAt: '2026-07-24T04:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('저장소');
    expect(html).toContain('공개로 전환했습니다');
    expect(html).toContain('repository-synthetic-1');
  });

  it('PROGRAM_ARCHIVED 행이 이름을 받으면 서술문과 메타 라인 모두 cuid 대신 이름을 "@" 없이 보여준다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-program-archived',
            actor: 'synthetic-staff',
            action: 'PROGRAM_ARCHIVED',
            targetType: 'PROGRAM',
            targetId: 'cuid-synthetic-program-1',
            target: '합성 프로그램 이름',
            occurredAt: '2026-07-24T04:30:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    // 서술문: 이름이 보이고 '@' 접두는 붙지 않는다.
    expect(html).toContain('합성 프로그램 이름');
    expect(html).not.toContain('@합성 프로그램 이름');
    // 메타 라인: 사용자가 지목한 지점 — 이름을 알면 cuid 원값 대신 이름을 보여준다.
    expect(html).not.toContain('cuid-synthetic-program-1');
  });

  it('PROGRAM_ARCHIVED 행이 이름을 모르면(폴백) 메타 라인에 여전히 targetId(cuid)를 코드체로 보여준다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-program-archived-fallback',
            actor: 'synthetic-staff',
            action: 'PROGRAM_ARCHIVED',
            targetType: 'PROGRAM',
            targetId: 'cuid-synthetic-program-2',
            target: 'PROGRAM / cuid-synthetic-program-2',
            occurredAt: '2026-07-24T04:31:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('cuid-synthetic-program-2');
  });

  it('REPOSITORY_PUBLISHED 행이 전체 이름(owner/name)을 받으면 메타 라인이 cuid 대신 그 이름을 보여준다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-repository-resolved',
            actor: 'synthetic-staff',
            action: 'REPOSITORY_PUBLISHED',
            targetType: 'REPOSITORY',
            targetId: 'cuid-synthetic-repository-1',
            target: 'synthetic-org/synthetic-repo',
            occurredAt: '2026-07-24T04:32:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('synthetic-org/synthetic-repo');
    expect(html).not.toContain('cuid-synthetic-repository-1');
  });

  it('APPLICATION_APPROVED 행이 합성 라벨(프로그램 이름 · @신청자)을 받으면 메타 라인이 cuid 대신 그 라벨을 보여준다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-application-resolved',
            actor: 'synthetic-staff',
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'cuid-synthetic-application-1',
            target: '합성 프로그램 · @synthetic-applicant',
            occurredAt: '2026-07-24T04:33:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('합성 프로그램 · @synthetic-applicant');
    expect(html).not.toContain('cuid-synthetic-application-1');
  });

  it('APPLICATION_APPROVED 행이 라벨을 모르면(폴백) 메타 라인에 여전히 targetId(cuid)를 코드체로 보여준다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-application-fallback',
            actor: 'synthetic-staff',
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'cuid-synthetic-application-2',
            target: 'APPLICATION / cuid-synthetic-application-2',
            occurredAt: '2026-07-24T04:34:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('cuid-synthetic-application-2');
  });

  it('COLLECTION_SYNC_TRIGGERED 행은 폴백이어도 메타 라인에 runId를 보여주지 않는다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-collection-sync',
            actor: 'synthetic-admin',
            action: 'COLLECTION_SYNC_TRIGGERED',
            targetType: 'COLLECTION_SYNC',
            targetId: 'run-synthetic-1',
            // COLLECTION_SYNC는 스냅샷도 join도 없어 항상 이 폴백 형태다
            // (resolveAuditTargetLabel 참고).
            target: 'COLLECTION_SYNC / run-synthetic-1',
            occurredAt: '2026-07-24T05:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    // 문장에는 애초에 target이 없고(describe.test.ts에서 별도 검증), 메타
    // 라인도 TARGETLESS_FALLBACK_TARGET_TYPES에 걸려 targetId(runId)를 아예
    // 렌더하지 않는다 — 사람에게 의미 없는 실행 식별자를 그대로 노출하지 않는다.
    expect(html).not.toContain('run-synthetic-1');
    // targetType 배지는 그대로 남아 이 행이 무엇에 대한 기록인지는 알 수 있다.
    expect(html).toContain('데이터 수집');
    expect(html).toContain('님이 데이터 수집을 수동 실행했습니다');
  });

  it('COLLECTION_SYNC 생략은 다른 targetType의 폴백 행으로 번지지 않는다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-program-archived-fallback-2',
            actor: 'synthetic-staff',
            action: 'PROGRAM_ARCHIVED',
            targetType: 'PROGRAM',
            targetId: 'cuid-synthetic-program-3',
            target: 'PROGRAM / cuid-synthetic-program-3',
            occurredAt: '2026-07-24T05:01:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    // PROGRAM은 TARGETLESS_FALLBACK_TARGET_TYPES에 없다 — 폴백이어도 targetId는
    // 여전히 원본 참조값으로서 코드체로 남아야 한다(생략이 전체로 번지지 않았다는
    // 부정 단언).
    expect(html).toContain('cuid-synthetic-program-3');
  });

  it('알 수 없는 action도 원본 값을 담은 폴백 문장으로 숨기지 않고 보여준다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-unknown',
            actor: 'synthetic-admin',
            action: 'LEGACY_SYNTHETIC_ACTION',
            targetType: 'ROLE_REQUEST',
            targetId: 'request-1',
            target: 'synthetic-target',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('기타 작업');
    expect(html).toContain('LEGACY_SYNTHETIC_ACTION');
    expect(html).toContain('작업을 수행했습니다');
  });

  it('필터 이름을 각 컨트롤과 연결한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    for (const [label, id] of [
      ['행위자', 'audit-actor'],
      ['액션 종류', 'audit-action'],
      ['시작일', 'audit-from'],
      ['종료일', 'audit-to'],
    ]) {
      expect(html).toContain(`<label for="${id}"`);
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(label);
    }
  });

  it('백엔드 action registry 전체(REPOSITORY_PUBLISHED 포함)를 필터의 API 값과 한국어 표시 이름으로 제공한다', () => {
    for (const [value, label] of [
      ['', '전체'],
      ['STAFF_ROLE_REQUEST_APPROVED', '승인'],
      ['STAFF_ROLE_REQUEST_REJECTED', '반려'],
      ['STAFF_ROLE_REQUEST_REVOKED', '회수'],
      ['STAFF_ROLE_REQUEST_RESTORED', '복구'],
      ['USER_ROLE_CHANGED', '역할 변경'],
      ['USER_ACCOUNT_STATUS_CHANGED', '계정 상태 변경'],
      ['REPOSITORY_PUBLISHED', '저장소 공개'],
    ]) {
      const html = renderToStaticMarkup(
        <AuditLogView
          {...baseProps}
          filters={{ ...baseProps.filters, action: value }}
          records={[]}
          isLoading={false}
          errorMessage={null}
        />,
      );

      expect(html).toContain(
        `<option value="${value}" selected="">${label}</option>`,
      );
    }
  });

  it('전체 건수와 현재 페이지를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={2}
        total={45}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('총 45건');
    expect(html).toContain('2 / 3 페이지');
  });

  it('첫 페이지에서는 이전으로, 마지막 페이지에서는 다음으로 넘어갈 수 없다', () => {
    const firstPage = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={1}
        total={25}
        isLoading={false}
        errorMessage={null}
      />,
    );
    const lastPage = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={2}
        total={25}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(isButtonDisabled(firstPage, '이전')).toBe(true);
    expect(isButtonDisabled(firstPage, '다음')).toBe(false);
    expect(isButtonDisabled(lastPage, '이전')).toBe(false);
    expect(isButtonDisabled(lastPage, '다음')).toBe(true);
  });

  it('결과가 한 페이지에 다 들어가면 양쪽 이동을 모두 막는다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={1}
        total={3}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('1 / 1 페이지');
    expect(isButtonDisabled(html, '이전')).toBe(true);
    expect(isButtonDisabled(html, '다음')).toBe(true);
  });

  it('기록이 20건을 넘어도 한 페이지에 담긴 만큼만 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-1',
            actor: 'synthetic-admin',
            action: 'STAFF_ROLE_REQUEST_APPROVED',
            targetType: 'ROLE_REQUEST',
            targetId: 'request-1',
            // 폴백 라벨(target === `${targetType} / ${targetId}`)로 둬서 이 테스트가
            // 검증하려는 건 페이지네이션이지 target 라벨 로직이 아님을 명확히 한다.
            target: 'ROLE_REQUEST / request-1',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        page={1}
        total={100}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('총 100건');
    expect(html).toContain('1 / 5 페이지');
    expect(html).toContain('request-1');
  });

  it('표 스크롤 영역에 접근성 이름을 부여한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('감사 로그 표');
  });
});
