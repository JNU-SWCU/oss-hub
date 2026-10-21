import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import {
  SystemStatusResponseDto,
  systemStatusResponse,
} from '../dto/system-status-response.dto';
import { SystemStatusService } from '../service/system-status.service';

@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  @UseGuards(SessionGuard)
  async getStatus(
    @Req() request: AuthenticatedRequest,
  ): Promise<SystemStatusResponseDto> {
    return systemStatusResponse(
      await this.service.getStatus(request.sessionGithubId),
    );
  }
}
