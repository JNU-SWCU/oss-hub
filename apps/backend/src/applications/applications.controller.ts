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
import { OriginGuard } from '../auth/controller/origin.guard';
import { SessionGuard } from '../auth/controller/session.guard';
import {
  ApplicationsStaffGuard,
  ApplicationsStaffListGuard,
} from './applications-staff.guard';
import type { ApplicationStaffRequest } from './applications-staff.guard';
import { ApplicationsService } from './applications.service';
import {
  type ApplicationDecisionResponseDto,
  toApplicationDecisionResponse,
} from './dto/application-decision-response.dto';
import { ApplicationDetailResponseDto } from './dto/application-detail-response.dto';
import { PatchApplicationDecisionRequestDto } from './dto/patch-application-decision-request.dto';

type ApplicationActorRequest = Pick<
  ApplicationStaffRequest,
  'applicationActorId' | 'sessionGithubId'
>;

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
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async detail(
    @Param('id') applicationId: string,
  ): Promise<ApplicationDetailResponseDto> {
    return ApplicationDetailResponseDto.fromDetail(
      await this.service.getForStaff(applicationId),
    );
  }

  @Patch(':id')
  @UseGuards(SessionGuard, ApplicationsStaffGuard, OriginGuard)
  async decide(
    @Req() request: ApplicationActorRequest,
    @Param('id') applicationId: string,
    @Body() body: PatchApplicationDecisionRequestDto,
  ): Promise<ApplicationDecisionResponseDto> {
    const result = await this.service.decide(
      request.applicationActorId,
      applicationId,
      request.sessionGithubId,
      body.toAction(),
    );
    return toApplicationDecisionResponse(result);
  }
}
