import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { SystemStatusResponseDto } from '../dto/system-status-response.dto';
import { SystemStatusService } from '../service/system-status.service';

@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  @UseGuards(SessionGuard)
  getStatus(
    @Req() request: AuthenticatedRequest,
  ): Promise<SystemStatusResponseDto> {
    return this.service.getStatus(request.sessionGithubId);
  }
}
