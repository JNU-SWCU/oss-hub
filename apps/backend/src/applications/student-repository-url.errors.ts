import { DomainException, type ErrorCode } from '../common/error-code';

export const STUDENT_REPOSITORY_URL_ERRORS = {
  closed: {
    code: 'APP_028',
    status: 409,
    message: '승인된 신청만 프로그램 종료 전에 저장소를 변경할 수 있습니다.',
  },
  conflict: {
    code: 'APP_029',
    status: 409,
    message: '다른 신청에 연결된 저장소입니다.',
  },
  busy: {
    code: 'APP_030',
    status: 409,
    message: '저장소를 처리 중입니다. 잠시 후 다시 시도해 주세요.',
  },
  unavailable: {
    code: 'APP_031',
    status: 503,
    message: 'GitHub 저장소를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    exposeToClient: true,
  },
} as const satisfies Record<string, ErrorCode>;

export function repositoryUrlError(
  kind: keyof typeof STUDENT_REPOSITORY_URL_ERRORS,
): DomainException {
  return new DomainException(STUDENT_REPOSITORY_URL_ERRORS[kind]);
}
