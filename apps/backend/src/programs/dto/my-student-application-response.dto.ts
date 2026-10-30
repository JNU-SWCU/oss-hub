import type { StudentApplicationResponseDto } from './student-application-response.dto';

export class MyStudentApplicationResponseDto {
  declare readonly status: 'NONE' | StudentApplicationResponseDto['status'];
  declare readonly application?: StudentApplicationResponseDto;

  static from(
    application: StudentApplicationResponseDto | null,
  ): MyStudentApplicationResponseDto {
    if (application === null) {
      return { status: 'NONE' };
    }
    return { status: application.status, application };
  }
}
