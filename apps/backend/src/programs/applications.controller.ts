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
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ApplicationsService } from './applications.service';
import { ApplicationDecisionResponseDto } from './dto/application-decision-response.dto';
import { ApplicationDetailResponseDto } from './dto/application-list-page-response.dto';
import { PatchApplicationDecisionRequestDto } from './dto/patch-application-decision-request.dto';
import { Protected } from '../auth/authentication.guard';

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
  @Protected()
  async detail(
    @Req() request: ApplicationActorRequest,
    @Param('id') applicationId: string,
  ): Promise<ApplicationDetailResponseDto> {
    return ApplicationDetailResponseDto.from(
      await this.service.getForStaff(request.sessionGithubId, applicationId),
    );
  }

  @Patch(':id')
  @Protected()
  @UseGuards(OriginGuard)
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
    return ApplicationDecisionResponseDto.from(result);
  }
}
