import {
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  Header,
  HttpCode,
  Injectable,
  type NestInterceptor,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DomainException } from '../common/error-code';
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
import {
  SubmissionFilesService,
  type SubmissionFileUpload,
  type UploadedSubmissionFileResponse,
} from './submission-files.service';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';
import { SubmissionMatrixService } from './submission-matrix.service';
import { SubmissionsService } from './submissions.service';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const MultipartFileInterceptor = FileInterceptor('file', {
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldNameSize: 100,
    fieldSize: 512,
    fields: 2,
    files: 1,
    parts: 3,
  },
});

@Injectable()
class SubmissionFileUploadInterceptor
  extends MultipartFileInterceptor
  implements NestInterceptor
{
  override async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          throw new DomainException(
            SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.FILE_TOO_LARGE],
          );
        }
        if (
          [
            'LIMIT_FIELD_KEY',
            'LIMIT_FIELD_VALUE',
            'LIMIT_FIELD_COUNT',
            'LIMIT_FILE_COUNT',
            'LIMIT_PART_COUNT',
            'LIMIT_UNEXPECTED_FILE',
          ].includes(String(error.code))
        ) {
          throw new DomainException(
            SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.INVALID_FILE_UPLOAD],
          );
        }
      }
      throw error;
    }
  }
}

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

@Controller('submission-files')
export class SubmissionFilesController {
  constructor(private readonly service: SubmissionFilesService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(SubmissionFileUploadInterceptor)
  upload(
    @Req() request: SubmissionRequest,
    @Body('applicationId') applicationId: unknown,
    @Body('milestoneId') milestoneId: unknown,
    @UploadedFile() file: SubmissionFileUpload | undefined,
  ): Promise<UploadedSubmissionFileResponse> {
    return this.service.upload(
      request.sessionGithubId,
      applicationId,
      milestoneId,
      file,
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
