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
import { OriginGuard } from '../../auth/controller/origin.guard';
import { SessionGuard } from '../../auth/controller/session.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { ApplicationsService } from '../service/applications.service';
import {
  type ApplicationDecisionResponseDto,
  toApplicationDecisionResponse,
} from '../dto/application-decision-response.dto';
import { ApplicationDetailResponseDto } from '../dto/application-list-response.dto';
import { PatchApplicationDecisionRequestDto } from '../dto/patch-application-decision-request.dto';

type ApplicationActorRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

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
  @UseGuards(SessionGuard)
  async detail(
    @Req() request: ApplicationActorRequest,
    @Param('id') applicationId: string,
  ): Promise<ApplicationDetailResponseDto> {
    return ApplicationDetailResponseDto.fromDetail(
      await this.service.getForStaff(request.sessionGithubId, applicationId),
    );
  }

  @Patch(':id')
  @UseGuards(SessionGuard, OriginGuard)
  async decide(
    @Req() request: ApplicationActorRequest,
    @Param('id') applicationId: string,
    @Body() body: PatchApplicationDecisionRequestDto,
  ): Promise<ApplicationDecisionResponseDto> {
    const result = await this.service.decide(
      request.sessionGithubId,
      applicationId,
      body,
    );
    return toApplicationDecisionResponse(result);
  }
}
