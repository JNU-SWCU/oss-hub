import { Controller, Get, Header, Param, Req, Query } from '@nestjs/common';
import { SubmissionChecklistResponseDto } from './dto/submission-form-response.dto';
import { SubmissionsService } from './submissions.service';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SubmissionMatrixRequestDto } from './dto/submission-matrix-request.dto';
import { SubmissionMatrixResponseDto } from './dto/submission-matrix-response.dto';
import { SubmissionMatrixService } from './submission-matrix.service';
import { Protected } from '../auth/authentication.guard';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/submissions')
export class ProgramSubmissionsController {
  constructor(
    private readonly service: SubmissionsService,
    private readonly matrixService: SubmissionMatrixService,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  checklist(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
  ): Promise<SubmissionChecklistResponseDto> {
    return this.service
      .checklist(request.sessionGithubId, programId)
      .then((result) => SubmissionChecklistResponseDto.from(result));
  }

  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async matrix(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Query() query: SubmissionMatrixRequestDto,
  ): Promise<SubmissionMatrixResponseDto> {
    const result = await this.matrixService.matrix(
      request.sessionGithubId,
      programId,
      query.toQuery(),
    );
    return SubmissionMatrixResponseDto.from(result, programId);
  }
}
