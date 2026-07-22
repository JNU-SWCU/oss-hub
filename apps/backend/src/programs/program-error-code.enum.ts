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
    message: '���α׷� �Է°��� �ùٸ��� �ʽ��ϴ�.',
  },
  [ProgramErrorCode.FORBIDDEN]: {
    code: ProgramErrorCode.FORBIDDEN,
    status: 403,
    message: '���α׷��� ������ ������ �����ϴ�.',
  },
  [ProgramErrorCode.STAFF_APPROVAL_REQUIRED]: {
    code: ProgramErrorCode.STAFF_APPROVAL_REQUIRED,
    status: 403,
    message: '������ ���� �� ���α׷��� ������ �� �ֽ��ϴ�.',
  },
  [ProgramErrorCode.PROGRAM_NOT_FOUND]: {
    code: ProgramErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message: '���α׷��� ã�� �� �����ϴ�.',
  },
  [ProgramErrorCode.MILESTONE_NOT_FOUND]: {
    code: ProgramErrorCode.MILESTONE_NOT_FOUND,
    status: 404,
    message: '���Ͻ����� ã�� �� �����ϴ�.',
  },
  [ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS]: {
    code: ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS,
    status: 409,
    message: '��û�ڰ� �ִ� ���α׷��� ������ ������ �� �����ϴ�.',
  },
  [ProgramErrorCode.INVALID_APPLICATION_PERIOD]: {
    code: ProgramErrorCode.INVALID_APPLICATION_PERIOD,
    status: 422,
    message: '��û �Ⱓ�� �ùٸ��� �ʽ��ϴ�.',
  },
  [ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END]: {
    code: ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END,
    status: 422,
    message: '���Ͻ��� �������� ��û ���� ���Ŀ��� �մϴ�.',
  },
  [ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS]: {
    code: ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS,
    status: 409,
    message: '���⹰�� �ִ� ���Ͻ����� ������ �� �����ϴ�.',
  },
  [ProgramErrorCode.MILESTONE_REQUIRED]: {
    code: ProgramErrorCode.MILESTONE_REQUIRED,
    status: 422,
    message: '����� ���κ����׿��� �ּ� 1�� �̻��� ���Ͻ����� �ʿ��մϴ�.',
  },
};
