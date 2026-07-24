import type { ErrorCode } from '../common/error-code';

export enum ProgramErrorCode {
  VALIDATION_ERROR = 'PRG_001',
  FORBIDDEN = 'PRG_002',
  STAFF_APPROVAL_REQUIRED = 'PRG_003',
  PROGRAM_NOT_FOUND = 'PRG_004',
  MILESTONE_NOT_FOUND = 'PRG_005',
  CATEGORY_LOCKED_BY_APPLICATIONS = 'PRG_006',
  INVALID_APPLICATION_PERIOD = 'PRG_007',
  MILESTONE_BEFORE_APPLICATION_END = 'PRG_008',
  MILESTONE_HAS_SUBMISSIONS = 'PRG_009',
  MILESTONE_REQUIRED = 'PRG_010',
}

export const PROGRAM_ERROR_CODES: Record<ProgramErrorCode, ErrorCode> = {
  [ProgramErrorCode.VALIDATION_ERROR]: {
    code: ProgramErrorCode.VALIDATION_ERROR,
    status: 400,
    message: '프로그램 입력값이 올바르지 않습니다.',
  },
  [ProgramErrorCode.FORBIDDEN]: {
    code: ProgramErrorCode.FORBIDDEN,
    status: 403,
    message: '프로그램을 생성할 권한이 없습니다.',
  },
  [ProgramErrorCode.STAFF_APPROVAL_REQUIRED]: {
    code: ProgramErrorCode.STAFF_APPROVAL_REQUIRED,
    status: 403,
    message: '승인된 운영진만 프로그램을 수정할 수 있습니다.',
  },
  [ProgramErrorCode.PROGRAM_NOT_FOUND]: {
    code: ProgramErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message: '프로그램을 찾을 수 없습니다.',
  },
  [ProgramErrorCode.MILESTONE_NOT_FOUND]: {
    code: ProgramErrorCode.MILESTONE_NOT_FOUND,
    status: 404,
    message: '마일스톤을 찾을 수 없습니다.',
  },
  [ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS]: {
    code: ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS,
    status: 409,
    message: '신청자가 있는 프로그램은 유형을 변경할 수 없습니다.',
  },
  [ProgramErrorCode.INVALID_APPLICATION_PERIOD]: {
    code: ProgramErrorCode.INVALID_APPLICATION_PERIOD,
    status: 422,
    message: '신청 기간이 올바르지 않습니다.',
  },
  [ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END]: {
    code: ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END,
    status: 422,
    message: '마일스톤 마감일은 신청 종료 이후여야 합니다.',
  },
  [ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS]: {
    code: ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS,
    status: 409,
    message: '제출물이 있는 마일스톤은 삭제할 수 없습니다.',
  },
  [ProgramErrorCode.MILESTONE_REQUIRED]: {
    code: ProgramErrorCode.MILESTONE_REQUIRED,
    status: 422,
    message: '팀 프로그램에는 최소 1개 이상의 마일스톤이 필요합니다.',
  },
};
