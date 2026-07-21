import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CollectionModule } from './collection/collection.module';
import { ConsentsModule } from './consents/consents.module';
import { HealthModule } from './health/health.module';
import { LoginHistoryModule } from './login-history/login-history.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgramsModule } from './programs/programs.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    LoginHistoryModule,
    AuthModule,
    CollectionModule,
    ConsentsModule,
    RolesModule,
    ProgramsModule,
  ],
})
export class AppModule {}
