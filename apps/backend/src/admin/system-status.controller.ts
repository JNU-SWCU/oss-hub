import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { SystemStatusResponseDto } from './dto/system-status-response.dto';
import { SystemStatusService } from './system-status.service';
import { Protected } from '../auth/authentication.guard';
import { ADMIN_AUDIENCE, Roles } from '../platform/roles.guard';

const adminRequired = () =>
  new ForbiddenException('Active administrator access is required');

@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  @Protected()
  @Roles(ADMIN_AUDIENCE, adminRequired)
  async getStatus(): Promise<SystemStatusResponseDto> {
    return SystemStatusResponseDto.from(await this.service.getStatus());
  }
}
