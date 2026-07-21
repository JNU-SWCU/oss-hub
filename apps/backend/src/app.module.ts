import { Module } from '@nestjs/common';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { CollectionModule } from './collection/collection.module';
import { ConsentsModule } from './consents/consents.module';
import { HealthModule } from './health/health.module';
import { LoginHistoryModule } from './login-history/login-history.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgramsModule } from './programs/programs.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoryOwnershipModule } from './repository-ownership/repository-ownership.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    LoginHistoryModule,
    AuthModule,
    CollectionModule,
    RankingModule,
    ConsentsModule,
    ApplicationsModule,
    RolesModule,
    ProgramsModule,
    RepositoryOwnershipModule,
  ],
})
export class AppModule {}
