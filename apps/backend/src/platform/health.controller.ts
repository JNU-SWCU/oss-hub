import { Controller, Get } from '@nestjs/common';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';
import { Public } from '../auth/auth-route.decorator';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(): Promise<HealthResponseDto> {
    await this.healthService.assertDatabaseReachable();
    return HealthResponseDto.from();
  }
}
