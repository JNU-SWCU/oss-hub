import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateResubmissionRequestDto } from './dto/create-resubmission-request.dto';
import { CreateSubmissionRequestDto } from './dto/create-submission-request.dto';
import { SubmissionMatrixQueryRequestDto } from './dto/submission-matrix-query.dto';
import type { SubmissionMatrixResponseDto } from './dto/submission-matrix-response.dto';
import type {
  CreatedSubmissionResponseDto,
  ResubmittedSubmissionResponseDto,
  SubmissionChecklistResponseDto,
  SubmissionFormResponseDto,
} from './dto/submission-response.dto';
import { SubmissionMatrixService } from './submission-matrix.service';
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

@Controller('programs/:programId/submissions')
export class SubmissionChecklistController {
  constructor(private readonly service: SubmissionsService) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  checklist(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
  ): Promise<SubmissionChecklistResponseDto> {
    return this.service.checklist(request.sessionGithubId, programId);
  }
}

@Controller('programs/:programId/submissions')
export class SubmissionMatrixController {
  constructor(private readonly service: SubmissionMatrixService) {}

  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  matrix(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Query() query: SubmissionMatrixQueryRequestDto,
  ): Promise<SubmissionMatrixResponseDto> {
    return this.service.matrix(
      request.sessionGithubId,
      programId,
      query.toQuery(),
    );
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

  @Post(':submissionId/resubmissions')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  resubmit(
    @Req() request: SubmissionRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateResubmissionRequestDto,
  ): Promise<ResubmittedSubmissionResponseDto> {
    return this.service.resubmit(
      request.sessionGithubId,
      submissionId,
      body.toInput(),
    );
  }
}
