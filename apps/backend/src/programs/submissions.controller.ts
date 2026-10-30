import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import {
  CreateResubmissionRequestDto,
  CreateSubmissionRequestDto,
} from './dto/create-submission-request.dto';
import {
  presentCreatedSubmission,
  presentResubmittedSubmission,
  type CreatedSubmissionResponseDto,
  type ResubmittedSubmissionResponseDto,
} from './dto/submission-response.dto';
import { SubmissionsService } from './submissions.service';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly service: SubmissionsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  create(
    @Req() request: SubmissionRequest,
    @Body() body: CreateSubmissionRequestDto,
  ): Promise<CreatedSubmissionResponseDto> {
    return this.service
      .create(request.sessionGithubId, body.toInput())
      .then(presentCreatedSubmission);
  }

  @Post(':submissionId/resubmissions')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  resubmit(
    @Req() request: SubmissionRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateResubmissionRequestDto,
  ): Promise<ResubmittedSubmissionResponseDto> {
    return this.service
      .resubmit(request.sessionGithubId, submissionId, body.toInput())
      .then(presentResubmittedSubmission);
  }
}
