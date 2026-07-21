import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CollectionModule } from './collection/collection.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgramsModule } from './programs/programs.module';

@Module({
  imports: [PrismaModule, HealthModule, AuthModule, CollectionModule, ProgramsModule],
})
export class AppModule {}
