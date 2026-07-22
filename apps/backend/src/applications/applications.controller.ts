import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffGuard } from './applications-staff.guard';
import type { ApplicationStaffRequest } from './applications-staff.guard';
import { ApplicationsService } from './applications.service';
import {
  type ApplicationDecisionResponseDto,
  toApplicationDecisionResponse,
} from './dto/application-decision-response.dto';
import { PatchApplicationDecisionRequestDto } from './dto/patch-application-decision-request.dto';

type ApplicationActorRequest = Pick<
  ApplicationStaffRequest,
  'applicationActorId'
>;

@Controller('applications')
export class ApplicationsController {
  constructor(
    @Inject(ApplicationsService)
    private readonly service: Pick<ApplicationsService, 'decide'>,
  ) {}

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
      body.toAction(),
    );
    return toApplicationDecisionResponse(result);
  }
}
