import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  presentSubmissionChecklist,
  type SubmissionChecklistResponseDto,
} from './dto/submission-form-response.dto';
import { SubmissionsService } from './submissions.service';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { SubmissionMatrixRequestDto } from './dto/submission-matrix-request.dto';
import {
  presentSubmissionMatrix,
  type SubmissionMatrixResponseDto,
} from './dto/submission-matrix-response.dto';
import { SubmissionMatrixService } from './submission-matrix.service';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/submissions')
export class ProgramSubmissionsController {
  constructor(
    private readonly service: SubmissionsService,
    private readonly matrixService: SubmissionMatrixService,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  checklist(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
  ): Promise<SubmissionChecklistResponseDto> {
    return this.service
      .checklist(request.sessionGithubId, programId)
      .then(presentSubmissionChecklist);
  }

  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
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
    return presentSubmissionMatrix(result, programId);
  }
}
