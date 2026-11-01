import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { SystemStatusResponseDto } from './dto/system-status-response.dto';
import { SystemStatusService } from './system-status.service';
import { Protected } from '../auth/auth-route.decorator';
import { ADMIN_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';

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
