import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShowcasePublicController } from './showcase-public.controller';
import { ShowcasePublicService } from './showcase-public.service';
import { ShowcaseProjectionRepository } from './showcase-projection.repository';
import { ShowcaseProjectionService } from './showcase-projection.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShowcasePublicController],
  providers: [
    ShowcaseProjectionRepository,
    ShowcaseProjectionService,
    ShowcasePublicService,
  ],
  exports: [ShowcaseProjectionService],
})
export class ShowcaseModule {}
