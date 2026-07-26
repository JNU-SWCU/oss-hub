import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShowcaseProjectionRepository } from './showcase-projection.repository';
import { ShowcaseProjectionService } from './showcase-projection.service';

@Module({
  imports: [PrismaModule],
  providers: [ShowcaseProjectionRepository, ShowcaseProjectionService],
  exports: [ShowcaseProjectionService],
})
export class ShowcaseModule {}
