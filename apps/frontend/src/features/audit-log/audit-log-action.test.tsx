import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditLogActionValue } from './audit-log-action';

describe('AuditLogActionValue', () => {
  it.each([
    ['STAFF_ROLE_REQUEST_APPROVED', '승인', 'approved'],
    ['STAFF_ROLE_REQUEST_REJECTED', '반려', 'rejected'],
    ['STAFF_ROLE_REQUEST_REVOKED', '회수', 'closed'],
    ['STAFF_ROLE_REQUEST_RESTORED', '복구', 'approved'],
    ['USER_ROLE_CHANGED', '역할 변경', 'closed'],
    ['USER_ACCOUNT_STATUS_CHANGED', '계정 상태 변경', 'closed'],
    ['REPOSITORY_PUBLISHED', '저장소 공개', 'approved'],
    ['PROGRAM_CREATED', '프로그램 생성', 'approved'],
    ['PROGRAM_ARCHIVED', '프로그램 보관', 'closed'],
    ['PROGRAM_RESTORED', '프로그램 복구', 'approved'],
    ['PROGRAM_DELETED', '프로그램 삭제', 'closed'],
    ['TEAM_CREATED', '팀 생성', 'approved'],
    ['TEAM_JOINED', '팀 합류', 'approved'],
    ['COLLECTION_SYNC_TRIGGERED', '수집 실행', 'closed'],
    ['SUBMISSION_FILE_CLEANUP_RETRY_RESET', '제출 파일 정리 재시도', 'closed'],
    ['APPLICATION_SUBMITTED', '신청 제출', 'pending'],
    ['APPLICATION_APPROVED', '신청 승인', 'approved'],
    ['APPLICATION_REJECTED', '신청 반려', 'rejected'],
    ['APPLICATION_REVERTED', '신청 판정 취소', 'closed'],
    ['USER_PROFILE_UPDATED', '프로필 수정', 'closed'],
  ] as const)(
    '%s를 한국어 배지와 원본 값으로 함께 표시한다',
    (action, label, variant) => {
      const html = renderToStaticMarkup(
        <AuditLogActionValue action={action} />,
      );

      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).toContain(label);
      expect(html).toContain(action);
      expect(html).toContain('break-all');
    },
  );

  it('알 수 없는 과거 action도 숨기지 않고 원본 값을 보존한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogActionValue action="LEGACY_SYNTHETIC_ACTION" />,
    );

    expect(html).toContain('기타 작업');
    expect(html).toContain('LEGACY_SYNTHETIC_ACTION');
    expect(html).toContain('data-variant="closed"');
  });
});
