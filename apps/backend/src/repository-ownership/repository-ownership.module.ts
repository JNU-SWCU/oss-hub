import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RepositoryOwnerRepository } from './repository-owner.repository';

@Module({
  imports: [PrismaModule],
  providers: [RepositoryOwnerRepository],
  exports: [RepositoryOwnerRepository],
})
export class RepositoryOwnershipModule {}
