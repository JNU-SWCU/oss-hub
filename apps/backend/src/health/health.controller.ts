import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/auth-route-metadata';
import { HealthService } from './health.service';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(): Promise<{ status: 'ok' }> {
    const reachable = await this.healthService.isDatabaseReachable();
    if (!reachable) {
      throw new ServiceUnavailableException();
    }

    return { status: 'ok' };
  }
}
