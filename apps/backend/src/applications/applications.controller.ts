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
import { SessionGuard } from '../auth/session.guard';
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
import { ApplicationListItemResponseDto } from './dto/application-list-response.dto';
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

  /**
   * #722 신청 상세. 조회 성격이므로 `ApplicationsStaffListGuard`(`APP_018`)를 쓴다 —
   * 판정용 guard 와 권한 검사는 같고 실패 문구만 다르며, 그 구분이 이 모듈의 의도된
   * 설계다(`applications-staff.guard.ts`).
   */
  @Get(':id')
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async detail(
    @Param('id') applicationId: string,
  ): Promise<ApplicationListItemResponseDto> {
    return ApplicationListItemResponseDto.from(
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
