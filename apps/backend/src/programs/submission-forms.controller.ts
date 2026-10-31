import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import { SubmissionFormResponseDto } from './dto/submission-form-response.dto';
import { SubmissionsService } from './submissions.service';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { Protected } from '../auth/authentication.guard';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/milestones/:milestoneId')
export class SubmissionFormsController {
  constructor(private readonly service: SubmissionsService) {}

  @Get('submission-form')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async form(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Param('milestoneId') milestoneId: string,
  ): Promise<SubmissionFormResponseDto> {
    const result = await this.service.form(
      request.sessionGithubId,
      programId,
      milestoneId,
    );
    return SubmissionFormResponseDto.from(result, programId, milestoneId);
  }
}
