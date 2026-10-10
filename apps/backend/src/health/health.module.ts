import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './controller/health.controller';
import { HealthRepository } from './repository/health.repository';
import { HealthService } from './service/health.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthRepository, HealthService],
})
export class HealthModule {}
