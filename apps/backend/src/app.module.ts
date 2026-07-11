import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { MembersModule } from './members/members.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, HealthModule, MembersModule],
})
export class AppModule {}
