import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateSubmissionRequestDto } from './dto/create-submission-request.dto';
import type {
  CreatedSubmissionResponseDto,
  SubmissionFormResponseDto,
} from './dto/submission-response.dto';
import { SubmissionsService } from './submissions.service';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/milestones/:milestoneId')
export class SubmissionFormsController {
  constructor(private readonly service: SubmissionsService) {}

  @Get('submission-form')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  form(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Param('milestoneId') milestoneId: string,
  ): Promise<SubmissionFormResponseDto> {
    return this.service.form(request.sessionGithubId, programId, milestoneId);
  }
}

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
    return this.service.create(request.sessionGithubId, body.toInput());
  }
}
