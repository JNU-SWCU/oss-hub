import { ValidationPipe } from '@nestjs/common';
import type { JobDraft } from './mail-job.types';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Protected } from '../auth/auth-route.decorator';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { DomainException } from '../platform/error-code.error';
import { OriginGuard } from '../platform/origin.guard';
import { Roles } from '../platform/roles.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { ProgramMailDraftRequestDto } from './dto/program-mail-draft-request.dto';
import { ProgramMailSendRequestDto } from './dto/program-mail-send-request.dto';
import { DeadlineDigestGuidanceRequestDto } from './dto/deadline-digest-guidance-request.dto';
import { DeadlineDigestSendRequestDto } from './dto/deadline-digest-send-request.dto';
import { ProgramMailPreviewResponseDto } from './dto/program-mail-preview-response.dto';
import { DeadlineDigestPreviewResponseDto } from './dto/deadline-digest-preview-response.dto';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { MailJobsService } from './mail-jobs.service';
import { MailJobRequestDto } from './dto/mail-job-request.dto';
import { AcceptedMailResponseDto } from './dto/accepted-mail-response.dto';

function jobBody<P extends object, D extends object>(
  program: new () => P,
  deadline: new () => D,
) {
  const validator = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  async function validated<T extends object>(
    value: unknown,
    metatype: new () => T,
  ): Promise<T> {
    const result: unknown = await validator.transform(value, {
      type: 'body',
      metatype,
    });
    if (!(result instanceof metatype))
      throw new TypeError('Invalid mail request transformation');
    return result;
  }
  return {
    async transform(value: unknown): Promise<JobDraft<P, D>> {
      const parsed = await validated(value, MailJobRequestDto);
      if (parsed.kind === 'PROGRAM') {
        const draft = await validated(parsed.draft, program);
        return { kind: 'PROGRAM', draft };
      }
      const draft = await validated(parsed.draft, deadline);
      return { kind: 'DEADLINE', draft };
    },
  };
}

const staffOnly = () =>
  new DomainException(
    NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.STAFF_ONLY],
  );
const requestSchema = (
  program: new () => object,
  deadline: new () => object,
) => ({
  schema: {
    oneOf: (
      [
        ['PROGRAM', getSchemaPath(program)],
        ['DEADLINE', getSchemaPath(deadline)],
      ] as const
    ).map(([kind, ref]) => ({
      type: 'object',
      required: ['kind', 'draft'],
      properties: {
        kind: { type: 'string', enum: [kind] },
        draft: { $ref: ref },
      },
    })),
  },
});

@Controller('programs/:programId/mail')
@ApiExtraModels(
  ProgramMailDraftRequestDto,
  ProgramMailSendRequestDto,
  DeadlineDigestGuidanceRequestDto,
  DeadlineDigestSendRequestDto,
  ProgramMailPreviewResponseDto,
  DeadlineDigestPreviewResponseDto,
)
export class MailJobsController {
  constructor(private readonly mail: MailJobsService) {}

  @Post('previews')
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  @ApiBody(
    requestSchema(ProgramMailDraftRequestDto, DeadlineDigestGuidanceRequestDto),
  )
  @ApiOkResponse({
    schema: {
      oneOf: [
        ProgramMailPreviewResponseDto,
        DeadlineDigestPreviewResponseDto,
      ].map((model) => ({ $ref: getSchemaPath(model) })),
    },
  })
  async preview(
    @Param('programId') id: string,
    @Req() req: AuthenticatedRequest,
    @Body(jobBody(ProgramMailDraftRequestDto, DeadlineDigestGuidanceRequestDto))
    body: JobDraft<
      ProgramMailDraftRequestDto,
      DeadlineDigestGuidanceRequestDto
    >,
  ): Promise<ProgramMailPreviewResponseDto | DeadlineDigestPreviewResponseDto> {
    const result = await this.mail.preview(id, req.principal, body);
    return result.kind === 'PROGRAM'
      ? ProgramMailPreviewResponseDto.from(result.preview)
      : DeadlineDigestPreviewResponseDto.from(result.preview);
  }

  @Post('jobs')
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(202)
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  @ApiBody(
    requestSchema(ProgramMailSendRequestDto, DeadlineDigestSendRequestDto),
  )
  @ApiAcceptedResponse({
    type: AcceptedMailResponseDto,
    headers: { Location: { schema: { type: 'string' } } },
  })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  @ApiTooManyRequestsResponse()
  async accept(
    @Param('programId') id: string,
    @Req() req: AuthenticatedRequest,
    @Body(jobBody(ProgramMailSendRequestDto, DeadlineDigestSendRequestDto))
    body: JobDraft<ProgramMailSendRequestDto, DeadlineDigestSendRequestDto>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedMailResponseDto> {
    return AcceptedMailResponseDto.from(
      await this.mail.accept(id, req.principal, body, res),
    );
  }
}
