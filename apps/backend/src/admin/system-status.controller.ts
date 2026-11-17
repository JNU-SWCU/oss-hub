import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SystemStatusResponseDto } from './dto/system-status-response.dto';
import { ProvisioningRetryResponseDto } from './dto/provisioning-retry-response.dto';
import { SystemStatusService } from './system-status.service';
import { Protected } from '../auth/auth-route.decorator';
import { OriginGuard } from '../platform/origin.guard';
import { ADMIN_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { TeamApplicationService } from '../programs/team-application.service';

const adminRequired = () =>
  new ForbiddenException('Active administrator access is required');

@Controller('system-status')
export class SystemStatusController {
  constructor(
    private readonly service: SystemStatusService,
    private readonly applications: TeamApplicationService,
  ) {}

  @Get()
  @Protected()
  @Roles(ADMIN_AUDIENCE, adminRequired)
  async getStatus(): Promise<SystemStatusResponseDto> {
    return SystemStatusResponseDto.from(await this.service.getStatus());
  }

  @Post('provisioning/:teamId/retry')
  @HttpCode(202)
  @Protected()
  @Roles(ADMIN_AUDIENCE, adminRequired)
  @UseGuards(OriginGuard)
  async retryProvisioning(
    @Param('teamId') teamId: string,
  ): Promise<ProvisioningRetryResponseDto> {
    return ProvisioningRetryResponseDto.from(
      teamId,
      await this.applications.retryFailedRepositoryProvision(teamId),
    );
  }
}
