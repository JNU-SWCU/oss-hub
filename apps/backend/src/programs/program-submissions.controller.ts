import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { SubmissionMatrixRequestDto } from './dto/submission-matrix-request.dto';
import { SubmissionMatrixResponseDto } from './dto/submission-matrix-response.dto';
import { SubmissionMatrixService } from './submission-matrix.service';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
const staffOnly = () =>
  new DomainException(SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.STAFF_ONLY]);
@Controller('programs/:programId/submissions')
export class ProgramSubmissionsController {
  constructor(private readonly matrixService: SubmissionMatrixService) {}
  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async matrix(
    @Param('programId')
    programId: string,
    @Query()
    query: SubmissionMatrixRequestDto,
  ): Promise<SubmissionMatrixResponseDto> {
    const result = await this.matrixService.matrix(programId, query);
    return SubmissionMatrixResponseDto.from(result, programId);
  }
}
