import type { StudentApplicationView } from '../student-application-management.service';
import { StudentApplicationResponseDto } from './student-application-response.dto';

export class MyStudentApplicationResponseDto {
  declare readonly status: 'NONE' | StudentApplicationResponseDto['status'];
  declare readonly application?: StudentApplicationResponseDto;

  static from(
    view: StudentApplicationView | null,
  ): MyStudentApplicationResponseDto {
    if (view === null) {
      return { status: 'NONE' };
    }
    const application = StudentApplicationResponseDto.from(view);
    return { status: application.status, application };
  }
}
