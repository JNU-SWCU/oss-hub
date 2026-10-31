import { Controller, Get, Header, Param, Req, Query } from '@nestjs/common';
import { SubmissionChecklistResponseDto } from './dto/submission-form-response.dto';
import { SubmissionsService } from './submissions.service';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
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

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const staffOnly = () =>
  new DomainException(SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.STAFF_ONLY]);

@Controller('programs/:programId/submissions')
export class ProgramSubmissionsController {
  constructor(
    private readonly service: SubmissionsService,
    private readonly matrixService: SubmissionMatrixService,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async checklist(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
  ): Promise<SubmissionChecklistResponseDto> {
    return SubmissionChecklistResponseDto.from(
      await this.service.checklist(request.sessionGithubId, programId),
    );
  }

  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async matrix(
    @Param('programId') programId: string,
    @Query() query: SubmissionMatrixRequestDto,
  ): Promise<SubmissionMatrixResponseDto> {
    const result = await this.matrixService.matrix(programId, query);
    return SubmissionMatrixResponseDto.from(result, programId);
  }
}
