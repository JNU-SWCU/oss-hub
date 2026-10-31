import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ApplicationsService } from './applications.service';
import { ApplicationDecisionResponseDto } from './dto/application-decision-response.dto';
import { ApplicationDetailResponseDto } from './dto/application-list-page-response.dto';
import { PatchApplicationDecisionRequestDto } from './dto/patch-application-decision-request.dto';
import { Protected } from '../auth/authentication.guard';
import { Roles, STAFF_AUDIENCE } from '../platform/roles.guard';
import { DomainException } from '../platform/error-code.error';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.error';

type ApplicationActorRequest = Pick<AuthenticatedRequest, 'principal'>;

const staffListOnly = () =>
  new DomainException(
    APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY],
  );

const staffOnly = () =>
  new DomainException(
    APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_ONLY],
  );

@Controller('applications')
export class ApplicationsController {
  constructor(
    @Inject(ApplicationsService)
    private readonly service: Pick<
      ApplicationsService,
      'decide' | 'getForStaff'
    >,
  ) {}

  @Get(':id')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffListOnly)
  async detail(
    @Param('id') applicationId: string,
  ): Promise<ApplicationDetailResponseDto> {
    return ApplicationDetailResponseDto.from(
      await this.service.getForStaff(applicationId),
    );
  }

  @Patch(':id')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async decide(
    @Req() request: ApplicationActorRequest,
    @Param('id') applicationId: string,
    @Body() body: PatchApplicationDecisionRequestDto,
  ): Promise<ApplicationDecisionResponseDto> {
    const result = await this.service.decide(
      request.principal,
      applicationId,
      body,
    );
    return ApplicationDecisionResponseDto.from(result);
  }
}
