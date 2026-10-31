import { Controller, Get, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SystemStatusResponseDto } from './dto/system-status-response.dto';
import { SystemStatusService } from './system-status.service';
import { Protected } from '../auth/authentication.guard';

@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  @Protected()
  async getStatus(
    @Req() request: AuthenticatedRequest,
  ): Promise<SystemStatusResponseDto> {
    return SystemStatusResponseDto.from(
      await this.service.getStatus(request.sessionGithubId),
    );
  }
}
