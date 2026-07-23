import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';

describe('Program editor error contract', () => {
  it('documents ADR-stable frontend-facing error codes and statuses', () => {
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    ).toMatchObject({
      code: 'PRG_001',
      status: 400,
    });
    expect(PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN]).toMatchObject({
      code: 'PRG_002',
      status: 403,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.STAFF_APPROVAL_REQUIRED],
    ).toMatchObject({
      code: 'PRG_003',
      status: 403,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
    ).toMatchObject({
      code: 'PRG_004',
      status: 404,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_NOT_FOUND],
    ).toMatchObject({
      code: 'PRG_005',
      status: 404,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS],
    ).toMatchObject({
      code: 'PRG_006',
      status: 409,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.INVALID_APPLICATION_PERIOD],
    ).toMatchObject({
      code: 'PRG_007',
      status: 422,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END],
    ).toMatchObject({
      code: 'PRG_008',
      status: 422,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS],
    ).toMatchObject({
      code: 'PRG_009',
      status: 409,
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_REQUIRED],
    ).toMatchObject({
      code: 'PRG_010',
      status: 422,
    });
  });
});
