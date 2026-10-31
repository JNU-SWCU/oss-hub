import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { SystemStatusResponseDto } from './dto/system-status-response.dto';
import { SystemStatusService } from './system-status.service';

@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  @UseGuards(SessionGuard)
  async getStatus(
    @Req() request: AuthenticatedRequest,
  ): Promise<SystemStatusResponseDto> {
    return SystemStatusResponseDto.from(
      await this.service.getStatus(request.sessionGithubId),
    );
  }
}
